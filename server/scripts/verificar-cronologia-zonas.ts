/** Prueba de integración sobre una copia local. Crea un negocio QA aislado;
 * rechaza cualquier host remoto y nunca modifica el negocio real. */
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { crearConteo, inventarioActual, listarSnapshots } from '../src/inventario/service.js';
import { actualizarRecepcionReal } from '../src/inventario/compras-rapidas.js';
import { consumirVentasEpos, valorFifoAlCorte } from '../src/inventario/consumo-epos.js';
import { transferirLote } from '../src/inventario/ubicacion-lotes.js';
const url = new URL(process.env.DATABASE_URL ?? '');
assert(['localhost', '127.0.0.1'].includes(url.hostname) && /audit|test/i.test(url.pathname), 'Sólo base local de pruebas');
const time = (h: string) => new Date(`2026-11-01T${h}:00-06:00`);
const checks: string[] = [];
try {
  const negocio = await prisma.negocios.create({ data: { nombre: `QA cronología ${Date.now()}` } });
  const negocioId = negocio.id;
  const store = await prisma.stores.create({ data: { negocio_id: negocioId, name: `QA ${negocioId}` } });
  const user = await prisma.usuarios.create({ data: { negocio_id: negocioId, nombre: 'QA', pin_hash: 'no-login', rol: 'admin' } });
  const local = await prisma.zonas_inventario.create({ data: { negocio_id: negocioId, nombre: 'Local' } });
  const bodega = await prisma.zonas_inventario.create({ data: { negocio_id: negocioId, nombre: 'Bodega', orden: 1 } });
  const semana = await prisma.semanas.create({ data: { negocio_id: negocioId, etiqueta: 'QA', fecha_inicio: new Date('2026-10-26'), fecha_fin: new Date('2026-11-01') } });
  const p = await prisma.products.create({ data: { negocio_id: negocioId, store_id: store.id, name: `Físico QA ${negocioId}`, unidad_base: 'pieza', unidad_compra: 'pieza', contenido_compra: 1, unit_cost: 1 } });
  const fifo = await prisma.products.create({ data: { negocio_id: negocioId, store_id: store.id, name: `FIFO QA ${negocioId}`, unidad_base: 'pieza', unidad_compra: 'pieza', contenido_compra: 1, unit_cost: 1 } });
  await prisma.product_zone_units.createMany({ data: [p, fifo].flatMap(product => [local, bodega].map(z => ({ product_id: product.id, zona_id: z.id, unidad_captura: 'pieza', factor: 1 }))) });
  await prisma.producto_costos_historicos.createMany({ data: [
    { product_id: p.id, fecha: new Date(0), vigente_desde: new Date(0), costo: 1, contenido_compra: 1, unidad_base: 'pieza', fuente: 'QA' },
    { product_id: p.id, fecha: time('20:30'), vigente_desde: time('20:30'), costo: 2, contenido_compra: 1, unidad_base: 'pieza', fuente: 'QA' },
  ] });
  const line = (zone: bigint, qty: number) => ({ product_id: Number(p.id), zona_id: Number(zone), qty_captura: qty });
  const first = await crearConteo(negocioId, [line(bodega.id, 20)], { tipo: 'apertura', semana_id: Number(semana.id), contado_at: time('20:00').toISOString() });
  const second = await crearConteo(negocioId, [line(local.id, 10)], { tipo: 'apertura', semana_id: Number(semana.id), continuar_snapshot_id: first.snapshot_id, contado_at: time('21:00').toISOString() });
  const lines = await prisma.inventory_lines.findMany({ where: { snapshot_id: BigInt(second.snapshot_id) } });
  assert.equal(lines.find(l => l.zona_id === bodega.id)?.contado_at?.toISOString(), time('20:00').toISOString());
  const history = await listarSnapshots(negocioId, semana.id);
  assert.equal(history.find(s => s.oficial)?.id, second.snapshot_id);
  assert.equal(history.find(s => s.oficial)?.zonas.length, 2);
  assert.equal(Number((await prisma.inventario_semanal.findUniqueOrThrow({ where: { semana_id: semana.id } })).apertura_valor), 40);
  checks.push('Continuación conserva corte de Bodega y permite recuperar conteo oficial');
  checks.push('Valoración histórica respeta el costo vigente en cada zona, no la hora del segundo guardado');
  const beforeCount = await prisma.inventory_snapshot.count({ where: { negocio_id: negocioId } });
  await assert.rejects(() => crearConteo(negocioId, [line(local.id, 10)], { tipo: 'apertura', semana_id: Number(semana.id), continuar_snapshot_id: first.snapshot_id }), /oficial|cambió/);
  await assert.rejects(() => crearConteo(negocioId, [line(local.id, 10)], { tipo: 'apertura', semana_id: Number(semana.id), continuar_snapshot_id: second.snapshot_id }), /ya fue guardada/);
  assert.equal(await prisma.inventory_snapshot.count({ where: { negocio_id: negocioId } }), beforeCount);
  checks.push('Continuación obsoleta o repetida no deja snapshots huérfanos');
  const imp = await prisma.epos_importaciones.create({ data: { negocio_id: negocioId, clave: 'QA', periodo_desde: time('00:00'), periodo_hasta: new Date('2026-11-02T00:00:00-06:00') } });
  async function menu(productId: bigint, nombre: string, epos: number) {
    return prisma.productos_menu.create({ data: { negocio_id: negocioId, nombre, epos_product_id: epos, recetas: { create: [
      { version: 1, estado: 'validada', vigente_desde: new Date('2026-11-01'), lineas: { create: { product_id: productId, cantidad: nombre === 'FIFO' ? 2 : 1, unidad: 'pieza' } } },
      { version: 2, estado: 'validada', vigente_desde: new Date('2026-11-03'), lineas: { create: { product_id: productId, cantidad: 99, unidad: 'pieza' } } },
    ] } } });
  }
  await menu(p.id, 'Físico', 90001); await menu(fifo.id, 'FIFO', 90002);
  async function venta(hora: string, qty: number, nombre = 'Físico', id = 90001) {
    return prisma.epos_ventas.create({ data: { negocio_id: negocioId, importacion_id: imp.id, clave: nombre + hora, fecha: time(hora), epos_product_id: id, producto_nombre: nombre, cantidad: qty, venta_bruta: 0, metodo_pago: 'Cash' } });
  }
  await venta('20:40', 4);
  async function purchase(hora: string | null, qty: number, productId = p.id) {
    return prisma.purchases.create({ data: { negocio_id: negocioId, fecha_recepcion: new Date('2026-11-01'), recibida_at: hora ? time(hora) : null, total: qty, inventory_lots: { create: { negocio_id: negocioId, product_id: productId, zona_id: bodega.id, recibido_at: new Date('2026-11-01'), cantidad_inicial: qty, cantidad_restante: qty, costo_unitario: 1, fuente: 'manual' } } }, include: { inventory_lots: true } });
  }
  const late = await purchase('20:30', 5); await purchase('19:30', 7);
  const unknown = await purchase(null, 3);
  const state = async () => (await inventarioActual(negocioId)).productos.find(x => x.product_id === Number(p.id))!;
  assert.equal((await state()).existencia_actual_base, 35);
  assert((await inventarioActual(negocioId)).recepciones_sin_hora?.includes(Number(unknown.id)));
  checks.push('Compra entre cortes suma en Bodega; venta incluida en Local no se descuenta otra vez; hora desconocida visible');
  await venta('21:30', 4);
  assert.equal((await state()).existencia_actual_base, 31);
  await transferirLote({ negocioId, loteId: late.inventory_lots[0]!.id, zonaDestinoId: local.id, efectiva_at: time('22:00').toISOString() });
  const transferred = await state();
  assert.equal(transferred.existencia_actual_base, 31);
  assert.equal(transferred.por_zona.find(z => z.zona_id === Number(local.id))!.qty_captura, 11);
  checks.push('Ventas posteriores descuentan una vez y traslado no duplica recepción');
  assert.equal((await inventarioActual(negocioId, { hasta: time('20:45') })).productos.find(x => x.product_id === Number(p.id))!.existencia_actual_base, 21);
  checks.push('Consulta a una hora anterior no usa el conteo futuro de Local');
  const fifoPurchase = await purchase('22:00', 20, fifo.id);
  await venta('21:45', 1, 'FIFO', 90002); await venta('23:00', 1, 'FIFO', 90002);
  const cost = await consumirVentasEpos({ negocioId, from: time('00:00').toISOString(), to: new Date('2026-11-02T00:00:00-06:00').toISOString(), confirmar: true });
  const fifoSales = await prisma.epos_ventas.findMany({ where: { negocio_id: negocioId, producto_nombre: 'FIFO' }, orderBy: { fecha: 'asc' } });
  assert.equal(fifoSales[0]!.costeo_estado, 'excepcion');
  assert.equal(Number(fifoSales[1]!.costo_fifo), 2);
  assert.equal(Number((await prisma.inventory_lots.findUniqueOrThrow({ where: { id: fifoPurchase.inventory_lots[0]!.id } })).cantidad_restante), 18);
  assert.equal((await valorFifoAlCorte(negocioId, time('21:59'))).unidades, 7);
  assert.equal((await valorFifoAlCorte(negocioId, time('23:30'))).unidades, 25);
  checks.push('FIFO no usa compra posterior a venta y usa receta histórica, no futura; valoración respeta hora de recepción y venta');
  await assert.rejects(() => actualizarRecepcionReal(negocioId, user.id, fifoPurchase.id, time('23:30').toISOString()), /posterior a una venta/);
  const receipt = await actualizarRecepcionReal(negocioId, user.id, unknown.id, time('19:00').toISOString());
  assert.equal(receipt.recibida_at, time('19:00').toISOString());
  assert.equal(Number((await prisma.purchases.findUniqueOrThrow({ where: { id: unknown.id } })).total), 3);
  await assert.rejects(() => actualizarRecepcionReal(negocioId + 10000n, user.id, unknown.id, null), /no encontrada/);
  await assert.rejects(() => crearConteo(negocioId, [line(local.id, 1)], { tipo: 'ajuste', motivo: 'QA futuro', contado_at: '2099-01-01T00:00:00Z' }), /futuro/);
  checks.push('Hora inválida, futura, ajena o incompatible con FIFO bloqueada; pago sin cambios');
  const physicalBeforeRebase = (await state()).existencia_actual_base;
  await prisma.inventory_lots.create({ data: { negocio_id: negocioId, product_id: p.id, recibido_at: new Date('2026-10-26'), cantidad_inicial: 1810, cantidad_restante: 1810, costo_unitario: 1, fuente: 'ajuste_inventario' } });
  assert.equal((await state()).existencia_actual_base, physicalBeforeRebase);
  checks.push('Un rebase FIFO antiguo capturado tarde no se convierte en compra ni infla el físico');
  const close = await crearConteo(negocioId, [line(bodega.id, 1)], { tipo: 'cierre', semana_id: Number(semana.id), contado_at: time('23:00').toISOString() });
  const concurrentBefore = await prisma.inventory_snapshot.count({ where: { negocio_id: negocioId } });
  const concurrent = await Promise.allSettled([1, 2].map(() => crearConteo(negocioId, [line(local.id, 1)], { tipo: 'cierre', semana_id: Number(semana.id), continuar_snapshot_id: close.snapshot_id, contado_at: time('23:30').toISOString() })));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await prisma.inventory_snapshot.count({ where: { negocio_id: negocioId } }), concurrentBefore + 1);
  checks.push('Dos guardados simultáneos producen una sola continuación oficial, sin huérfanos');
  await prisma.semanas.update({ where: { id: semana.id }, data: { estado: 'cerrada' } });
  await assert.rejects(() => crearConteo(negocioId, [line(local.id, 1)], { tipo: 'cierre', semana_id: Number(semana.id) }), /semana abierta/);
  checks.push('No permite conteo oficial sobre semana cerrada');
  console.log(JSON.stringify({ ok: true, negocio_qa_local: Number(negocioId), checks, ventas_revisadas: cost.ventas, production_writes: 0 }));
} finally { await prisma.$disconnect(); }
