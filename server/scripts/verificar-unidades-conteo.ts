/** Auditoría de sólo lectura: la vista de apertura/cierre conserva cada saldo
 * histórico al convertirlo a su unidad de captura y volver a la unidad base.
 * Ejecutar con DATABASE_URL de una copia local restaurada de producción. */
import assert from 'node:assert/strict';
import { prisma as db } from '../src/db.js';
import { inventarioActual } from '../src/inventario/service.js';
import { cantidadBaseConteo, cantidadDesdeSaldo, medidaConteo } from '../../client/src/screens/inventario/conteo-unidades.js';

const url = new URL(process.env.DATABASE_URL ?? '');
assert(['localhost', '127.0.0.1'].includes(url.hostname) && /unidades_test/.test(url.pathname), 'Usa una copia local unidades_test');
try {
  const productos = await db.products.findMany({ where: { negocio_id: 1n }, include: { product_zone_units: true } });
  const lineas = await db.inventory_lines.findMany({ where: { inventory_snapshot: { negocio_id: 1n } } });
  let verificadas = 0;
  const conversiones = new Map<string, object>();
  for (const linea of lineas) {
    const p = productos.find(p => p.id === linea.product_id)!;
    assert(p, 'Producto del histórico disponible');
    const u = p.product_zone_units.find(u => u.zona_id === linea.zona_id);
    const producto = { ...p, contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra) };
    const unidad = u ? { factor: Number(u.factor), unidad_captura: u.unidad_captura } : undefined;
    const saldo = { qty_captura: Number(linea.qty_captura), factor: Number(linea.factor) };
    const visible = cantidadDesdeSaldo(saldo, producto, unidad);
    const base = saldo.qty_captura * saldo.factor;
    assert(Number.isFinite(visible), p.name);
    assert(Math.abs(cantidadBaseConteo(visible, producto, unidad) - base) < .00001, `${p.name}: no altera la cantidad histórica`);
    conversiones.set(String(p.id), { producto: p.name, unidad_base: p.unidad_base, ...medidaConteo(producto, unidad) });
    verificadas++;
  }
  const actual = await inventarioActual(1n);
  let zonas = 0;
  for (const p of actual.productos) for (const z of p.por_zona) {
    assert(Math.abs(z.qty_captura * z.factor - z.cantidad_base) < .00001, `${p.nombre}: API coherente`);
    const catalogo = productos.find(c => Number(c.id) === p.product_id)!;
    const producto = { ...catalogo, contenido_compra: catalogo.contenido_compra == null ? null : Number(catalogo.contenido_compra) };
    const visible = cantidadDesdeSaldo(z, producto);
    assert(Math.abs(cantidadBaseConteo(visible, producto) - z.cantidad_base) < .00001, p.nombre);
    zonas++;
  }
  console.log(JSON.stringify({ ok: true, escrituras: 0, lineas_historicas: verificadas, productos_activos: actual.productos.length, saldos_zona: zonas, medidas: [...conversiones.values()] }));
} finally { await db.$disconnect(); }
