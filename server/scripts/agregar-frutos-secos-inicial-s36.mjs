import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const N = 1n;
const TICKET = 'APERTURA-FRUTOS-SECOS-S36-2026-09-08';
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);
const result = await prisma.$transaction(async (tx) => {
  const week = await tx.semanas.findFirst({ where: { id: 66n, negocio_id: N }, select: { id: true, fecha_inicio: true, inventario_semanal: { select: { apertura_snapshot_id: true } } } });
  if (!week) throw new Error('No existe semana 66');
  const product = await tx.products.findFirst({ where: { id: 88n, negocio_id: N }, select: { id: true, name: true, unit_cost: true, contenido_compra: true } });
  if (!product) throw new Error('No existe Frutos secos (producto 88)');
  let lot = await tx.inventory_lots.findFirst({ where: { negocio_id: N, ticket_ref: TICKET } });
  let created = false;
  if (!lot) {
    lot = await tx.inventory_lots.create({ data: { negocio_id: N, product_id: product.id, recibido_at: week.fecha_inicio, cantidad_inicial: 40, cantidad_restante: 40, costo_unitario: Number(product.unit_cost) / Number(product.contenido_compra), moneda: 'MXN', fuente: 'inventario_inicial', ticket_ref: TICKET, notas: `Inventario inicial confirmado por el usuario: 40 g de Frutos secos para semana 36. Snapshot de apertura: ${week.inventario_semanal?.apertura_snapshot_id ?? 'sin enlace'}. No modifica el conteo fisico de cierre.` } });
    created = true;
  }
  return { created, lot: { id: lot.id, productId: lot.product_id, initial: lot.cantidad_inicial, remaining: lot.cantidad_restante, cost: lot.costo_unitario }, week: week.id };
});
console.log(json({ ok: true, result }));
await prisma.$disconnect();
