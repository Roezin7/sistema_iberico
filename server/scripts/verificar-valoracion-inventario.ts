/** Sólo lectura sobre una restauración local del caso real, nunca producción. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma as db } from '../src/db.js';
import { inventarioActual } from '../src/inventario/service.js';
import { resumen } from '../src/finanzas/service.js';
const url = new URL(process.env.DATABASE_URL ?? '');
assert(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname.includes('valoracion_test'), 'Requiere copia local de valoración');
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v, (_,x) => typeof x === 'bigint' ? String(x) : x)).digest('hex');
const evidencia = async () => ({
  dinero: hash(await db.movimientos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),
  arqueos: hash(await db.arqueos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),
  ventas: hash(await db.epos_ventas.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),
  lotes: hash(await db.inventory_lots.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),
  conteos: hash(await db.inventory_lines.findMany({where:{inventory_snapshot:{negocio_id:1n}},orderBy:[{snapshot_id:'asc'},{product_id:'asc'},{zona_id:'asc'}]})),
  productos: hash(await db.products.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),
});
try {
  const antes = await evidencia();
  const actual = await inventarioActual(1n), finanzas = await resumen(1n,75n);
  assert.equal(actual.productos.length,106);
  assert.equal(actual.valor_fifo_actual_total,27225.16);
  assert.equal(actual.valor_catalogo_total,30520.53);
  assert.equal(finanzas.inventario.valor_fifo_corte,actual.valor_fifo_actual_total);
  assert.equal(finanzas.inventario.valor_patrimonio,actual.valor_fifo_actual_total);
  assert.equal(finanzas.inventario.valor_catalogo_referencia,actual.valor_catalogo_total);
  assert.equal(finanzas.inventario.diferencia_fifo_vs_fisico,0);
  assert.equal(actual.valoracion_fifo.productos_con_diferencia_cantidad,0);
  assert.equal(actual.valoracion_fifo.capas_estimadas,23);
  assert.equal(actual.valoracion_fifo.valor_estimado,1847.70);
  assert.equal(actual.valoracion_fifo.provisional,true);
  assert.deepEqual(finanzas.inventario.valoracion_fifo,actual.valoracion_fifo);
  assert.deepEqual(await evidencia(),antes,'La valoración no escribe cantidades, costos, conteos, ventas, pagos ni arqueos');
  console.log(JSON.stringify({ok:true,productos:106,fifo:actual.valor_fifo_actual_total,catalogo_referencia:actual.valor_catalogo_total,capas_estimadas:23,valor_estimado:1847.70,diferencias_cantidad:0,evidencia_sin_cambio:true,production_writes:0}));
} finally { await db.$disconnect(); }
