import 'dotenv/config';
import { prisma } from '../src/db.js';

/**
 * Auditoría y normalización del catálogo de unidades.
 *
 * Regla: el inventario siempre usa g, ml o pieza. La presentación comercial
 * (botella, bolsa, caja, paquete, lata...) vive en unidad_compra y
 * contenido_compra. Las correcciones de este catálogo son semánticas: todas
 * las unidades discretas ya estaban contabilizadas como una unidad física,
 * por lo que no se multiplican lotes ni snapshots y no cambia su valor.
 *
 * Uso:
 *   npx tsx server/scripts/auditar-unidades-corregir.ts --dry-run
 *   npx tsx server/scripts/auditar-unidades-corregir.ts
 */

const negocio = await prisma.negocios.findFirst({ orderBy: { id: 'asc' }, select: { id: true, nombre: true } });
if (!negocio) throw new Error('No existe un negocio para auditar');

const discretos = new Set(['pieza', 'piezas', 'pz', 'pzas', 'unidad', 'unidades', 'ud', 'rollo', 'rollos', 'paquete', 'paquetes', 'pack', 'packs', 'bolsa', 'bolsas', 'caja', 'cajas', 'lata', 'latas']);
const canon = (value: string | null) => {
  const u = (value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  if (!u) return null;
  if (/^(g|gramo|gramos|gr)$/.test(u)) return 'g';
  if (/^(ml|mililitro|mililitros|cc)$/.test(u)) return 'ml';
  if (discretos.has(u)) return 'pieza';
  return null;
};

const dryRun = process.argv.includes('--dry-run');
const productos = await prisma.products.findMany({
  where: { negocio_id: negocio.id, active: true },
  orderBy: { id: 'asc' },
  select: { id: true, name: true, unidad_base: true, contenido_compra: true, unidad_compra: true, base_qty: true, unit_cost: true },
});

const cambios: Array<Record<string, unknown>> = [];
const correccionesLotes: Array<Record<string, unknown>> = [];
const noReconocidas: Array<Record<string, unknown>> = [];

for (const p of productos) {
  const unidad = canon(p.unidad_base);
  const antigua = p.unidad_base;
  if (!unidad) {
    if (antigua) noReconocidas.push({ id: Number(p.id), producto: p.name, unidad_base: antigua });
    else cambios.push({ id: Number(p.id), producto: p.name, unidad_base: null, nueva_unidad_base: 'pieza', razon: 'producto discreto sin unidad configurada' });
    continue;
  }
  const nuevoContenido = p.contenido_compra == null || Number(p.contenido_compra) <= 0 ? 1 : Number(p.contenido_compra);
  const nuevaCompra = p.unidad_compra?.trim() || (unidad === 'pieza' ? 'pieza' : unidad);
  if (antigua !== unidad || p.contenido_compra == null || Number(p.contenido_compra) <= 0 || p.unidad_compra?.trim() !== nuevaCompra) {
    cambios.push({
      id: Number(p.id), producto: p.name, unidad_base: antigua, nueva_unidad_base: unidad,
      contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra), nuevo_contenido_compra: nuevoContenido,
      unidad_compra: p.unidad_compra, nueva_unidad_compra: nuevaCompra,
    });
  }
}

if (!dryRun && cambios.length) {
  await prisma.$transaction(async (tx) => {
    for (const p of productos) {
      const unidad = canon(p.unidad_base) ?? (p.unidad_base ? null : 'pieza');
      if (!unidad) continue;
      const contenido = p.contenido_compra == null || Number(p.contenido_compra) <= 0 ? 1 : Number(p.contenido_compra);
      const unidadCompra = p.unidad_compra?.trim() || (unidad === 'pieza' ? 'pieza' : unidad);
      const debeCambiar = p.unidad_base !== unidad || p.contenido_compra == null || Number(p.contenido_compra) <= 0 || p.unidad_compra?.trim() !== unidadCompra;
      if (debeCambiar) {
        await tx.products.update({ where: { id: p.id }, data: { unidad_base: unidad, contenido_compra: contenido, unidad_compra: unidadCompra } });
      }
    }
  });
}

/**
 * Aperturas históricas anteriores a la normalización del catálogo se grabaron
 * en la presentación comercial (p. ej. 2 cajas), aunque el lote debe vivir en
 * unidad base (p. ej. 16 paquetes). Sólo corregimos lotes de apertura cuyo
 * costo todavía coincide con el precio completo de la presentación; así no se
 * tocan compras ya convertidas ni consumos históricos.
 */
const productosPorId = new Map(productos.map((p) => [p.id.toString(), p]));
const lotesApertura = await prisma.inventory_lots.findMany({
  where: {
    negocio_id: negocio.id,
    estado: 'abierto',
    fuente: 'inventario_inicial',
    notas: { contains: 'Apertura FIFO' },
  },
  select: { id: true, product_id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, notas: true },
});
for (const lote of lotesApertura) {
  const p = productosPorId.get(lote.product_id.toString());
  const contenido = p?.contenido_compra == null ? 1 : Number(p.contenido_compra);
  const esDiscretoConPresentacion = p?.unidad_base === 'pieza' && contenido > 1;
  const costoPresentacion = p?.unit_cost == null ? null : Number(p.unit_cost);
  const costoLote = Number(lote.costo_unitario);
  const costoEsPresentacion = costoPresentacion != null && Math.abs(costoLote - costoPresentacion) < 0.000001;
  if (!p || !esDiscretoConPresentacion || !costoEsPresentacion) continue;
  correccionesLotes.push({
    id: Number(lote.id), producto: p.name,
    cantidad_inicial: Number(lote.cantidad_inicial), nueva_cantidad_inicial: Number(lote.cantidad_inicial) * contenido,
    cantidad_restante: Number(lote.cantidad_restante), nueva_cantidad_restante: Number(lote.cantidad_restante) * contenido,
    costo_unitario: costoLote, nuevo_costo_unitario: costoLote / contenido,
    razon: 'apertura histórica capturada en presentación; normalizada a unidad base',
  });
}
if (!dryRun && correccionesLotes.length) {
  await prisma.$transaction(async (tx) => {
    for (const c of correccionesLotes) {
      // The product is looked up again below by lot id to avoid trusting log data.
      const lote = await tx.inventory_lots.findUnique({ where: { id: BigInt(c.id as number) }, select: { id: true, product_id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, notas: true } });
      if (!lote) continue;
      const producto = productosPorId.get(lote.product_id.toString());
      const contenido = producto?.contenido_compra == null ? 1 : Number(producto.contenido_compra);
      const costo = Number(lote.costo_unitario);
      const precio = producto?.unit_cost == null ? null : Number(producto.unit_cost);
      if (!producto || producto.unidad_base !== 'pieza' || contenido <= 1 || precio == null || Math.abs(costo - precio) >= 0.000001) continue;
      await tx.inventory_lots.update({ where: { id: lote.id }, data: {
        cantidad_inicial: Number(lote.cantidad_inicial) * contenido,
        cantidad_restante: Number(lote.cantidad_restante) * contenido,
        costo_unitario: costo / contenido,
        notas: `${lote.notas ?? ''} | Corrección unidades: presentación → pieza (${contenido} por presentación). Valor conservado.`,
      } });
    }
  });
}

const [lineas, lotes] = await Promise.all([
  prisma.inventory_lines.count({ where: { inventory_snapshot: { negocio_id: negocio.id } } }),
  prisma.inventory_lots.count({ where: { negocio_id: negocio.id } }),
]);

console.log(JSON.stringify({
  negocio: { id: Number(negocio.id), nombre: negocio.nombre },
  modo: dryRun ? 'dry-run' : 'aplicado',
  productos_activos: productos.length,
  cambios,
  correcciones_lotes: correccionesLotes,
  no_reconocidas: noReconocidas,
  filas_historicas_preservadas: { inventory_lines: lineas, inventory_lots: lotes },
  criterio: 'Las unidades discretas se normalizan a pieza sin cambiar cantidades; contenido_compra conserva cajas/paquetes por presentación.',
}, null, 2));

await prisma.$disconnect();
