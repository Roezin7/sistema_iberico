/** Regresión PostgreSQL real. Nunca usa producción; sólo DB local test/audit. */
import assert from 'node:assert/strict';
import { prisma as db } from '../src/db.js';
import { consumirVentasEpos } from '../src/inventario/consumo-epos.js';
import { crearBorradorCompra, confirmarBorradorCompra } from '../src/inventario/compras-rapidas.js';
const url = new URL(process.env.DATABASE_URL ?? '');
assert(['localhost','127.0.0.1'].includes(url.hostname) && /test|audit/.test(url.pathname), 'Sólo DB local de pruebas');
const checks: string[] = [];
const desde = '2026-11-06T00:00:00-06:00', hasta = '2026-11-07T00:00:00-06:00';
try {
  const n = await db.negocios.create({ data: { nombre: 'QA decimales ' + Date.now() } });
  const negocioId = n.id;
  const store = await db.stores.create({ data: { negocio_id: negocioId, name: 'Proveedor QA ' + n.id } });
  const user = await db.usuarios.create({ data: { negocio_id: negocioId, nombre: 'QA', pin_hash: 'sin-login', rol: 'admin' } });
  const caja = await db.ubicaciones_fondos.create({ data: { negocio_id: negocioId, nombre: 'Caja', tipo: 'efectivo' } });
  await db.zonas_inventario.create({ data: { negocio_id: negocioId, nombre: 'Bodega' } });
  await db.semanas.create({ data: { negocio_id: negocioId, etiqueta: 'QA45', fecha_inicio: new Date('2026-11-02'), fecha_fin: new Date('2026-11-08') } });
  const imp = await db.epos_importaciones.create({ data: { negocio_id: negocioId, clave: 'decimales', periodo_desde: new Date(desde), periodo_hasta: new Date(hasta) } });
  const crear = async (nombre: string, saldo: number, dosis: number) => {
    const p = await db.products.create({ data: { negocio_id: negocioId, store_id: store.id, name: nombre + n.id, unidad_base: 'g', contenido_compra: 1, unidad_compra: 'g', unit_cost: 10 } });
    const lote = await db.inventory_lots.create({ data: { negocio_id: negocioId, product_id: p.id, recibido_at: new Date('2026-11-05'), cantidad_inicial: saldo, cantidad_restante: saldo, costo_unitario: 10 } });
    const menu = await db.productos_menu.create({ data: { negocio_id: negocioId, nombre: nombre + n.id, recetas: { create: { version: 1, estado: 'validada', lineas: { create: { product_id: p.id, cantidad: dosis, unidad: 'g' } } } } } });
    const venta = await db.epos_ventas.create({ data: { negocio_id: negocioId, importacion_id: imp.id, clave: nombre, fecha: new Date('2026-11-06T20:00:00-06:00'), producto_nombre: menu.nombre, cantidad: 1, venta_bruta: 100, metodo_pago: 'Cash' } });
    return { p, lote, venta };
  };
  const exacto = await crear('Exacto', .56, .56);
  const sobre = await crear('Falta real', .56, .5602);
  const r = await consumirVentasEpos({ negocioId, from: desde, to: hasta, confirmar: true });
  assert.equal(r.costeadas, 1); assert.equal(r.excepciones, 1);
  for (const l of [exacto.lote, sobre.lote]) assert.equal(Number((await db.inventory_lots.findUniqueOrThrow({ where: { id: l.id } })).cantidad_restante), 0);
  assert.equal((await db.epos_ventas.findUniqueOrThrow({ where: { id: exacto.venta.id } })).costeo_estado, 'costeada');
  assert.match((await db.epos_ventas.findUniqueOrThrow({ where: { id: sobre.venta.id } })).costeo_error ?? '', /faltan 0.0002 g/);
  checks.push('0.56 se consume exactamente; 0.5602 contra 0.56 conserva faltante real, sin tolerancia ni stock negativo');
  const count = await db.inventory_consumptions.count({ where: { negocio_id: negocioId } });
  await consumirVentasEpos({ negocioId, from: desde, to: hasta, confirmar: true });
  assert.equal(await db.inventory_consumptions.count({ where: { negocio_id: negocioId } }), count);
  checks.push('Reintento no duplica consumos ni vuelve a descontar el lote agotado');
  const compra = await crearBorradorCompra(negocioId, user.id, { fecha_recepcion: '2026-11-06', total: 10, origen_pago_id: caja.id, lineas: [{ tipo_linea: 'inventario', product_id: sobre.p.id, descripcion_fuente: sobre.p.name, cantidad_fuente: 1, unidad_fuente: 'g', contenido_compra: 1, cantidad_base: 1, importe: 10 }] });
  const transaction = db.$transaction.bind(db); let transacciones = 0;
  (db as any).$transaction = (...args: any[]) => { if (++transacciones === 2) throw new Error('QA: falla técnica posterior al commit'); return (transaction as any)(...args); };
  let resultado;
  try { resultado = await confirmarBorradorCompra(negocioId, user.id, BigInt(compra.purchase_id)); }
  finally { (db as any).$transaction = transaction; }
  assert.equal(resultado.estado, 'confirmada'); assert.equal(resultado.costeo_en_vivo, null);
  assert.equal(resultado.advertencias_post_guardado[0]?.etapa, 'costeo_fifo');
  assert.equal((await db.purchases.findUniqueOrThrow({ where: { id: BigInt(compra.purchase_id) } })).estado, 'confirmada');
  assert.equal(await db.movimientos.count({ where: { compra_id: BigInt(compra.purchase_id) } }), 1);
  assert.equal(await db.inventory_lots.count({ where: { purchase_id: BigInt(compra.purchase_id) } }), 1);
  checks.push('Falla de recosteo posterior conserva compra, un lote y un pago con advertencia explícita');
  await confirmarBorradorCompra(negocioId, user.id, BigInt(compra.purchase_id));
  assert.equal(await db.movimientos.count({ where: { compra_id: BigInt(compra.purchase_id) } }), 1);
  assert.equal(await db.inventory_lots.count({ where: { purchase_id: BigInt(compra.purchase_id) } }), 1);
  checks.push('Reconfirmar después de una falla posterior no repite pagos ni lotes');
  console.log(JSON.stringify({ ok: true, negocio_qa: Number(negocioId), checks, production_writes: 0 }));
} finally { await db.$disconnect(); }
