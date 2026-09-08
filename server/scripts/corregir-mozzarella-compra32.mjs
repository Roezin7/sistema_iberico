import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const N = 1n;
const PURCHASE = 32n;
const OLD_OPENING_LOT = 488n;
const WRONG_LOT = 478n;
const TICKET = 'CORRECCION-COMPRA-32-MOZZARELLA-2026-09-08';
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchases.findUnique({ where: { id: PURCHASE }, select: { id: true, fecha_recepcion: true, proveedor: true, estado: true, notas: true } });
    if (!purchase) throw new Error('No existe la compra 32');
    const existing = await tx.inventory_lots.findFirst({ where: { negocio_id: N, ticket_ref: TICKET }, select: { id: true } });
    if (existing) return { alreadyApplied: true, correctionLotId: existing.id };

    const wrongLine = await tx.purchase_lines.findUnique({ where: { purchase_id_product_id: { purchase_id: PURCHASE, product_id: 57n } }, select: { qty: true, importe: true } });
    if (!wrongLine || Number(wrongLine.qty) !== 2000) throw new Error('La compra 32 ya fue modificada o no tiene la linea Manchego de 2000 g esperada');
    const wrongLot = await tx.inventory_lots.findUnique({ where: { id: WRONG_LOT }, select: { id: true, product_id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true } });
    if (!wrongLot || wrongLot.product_id !== 57n) throw new Error('No coincide el lote Manchego generado por la compra 32');
    const openingLot = await tx.inventory_lots.findUnique({ where: { id: OLD_OPENING_LOT }, select: { id: true, product_id: true, cantidad_inicial: true, cantidad_restante: true, estado: true, ticket_ref: true } });
    if (!openingLot || openingLot.product_id !== 52n || openingLot.ticket_ref !== 'APERTURA-FALTANTES-S36-2026-09-08') throw new Error('No coincide el lote inicial de Mozzarella a revertir');

    const consumed = await tx.inventory_consumptions.findMany({ where: { negocio_id: N, product_id: 52n, lote_id: OLD_OPENING_LOT, epos_venta_id: { not: null }, cantidad: { gt: 0 } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }], select: { id: true, cantidad: true } });
    const consumedQty = consumed.reduce((s, row) => s + Number(row.cantidad), 0);
    if (Math.abs(consumedQty - 530) > 0.001) throw new Error(`Se esperaban 530 g consumidos del lote inicial; se encontraron ${consumedQty}`);

    await tx.purchase_lines.update({ where: { purchase_id_product_id: { purchase_id: PURCHASE, product_id: 57n } }, data: { qty: 500, unidad_compra: 'bloque', contenido_compra: 500, costo_unitario: 0.184, importe: 92 } });
    await tx.purchase_lines.create({ data: { purchase_id: PURCHASE, product_id: 52n, qty: 1500, unidad_compra: 'bolsa', contenido_compra: 500, costo_unitario: 0.146, importe: 219 } });
    await tx.purchase_capture_lines.update({ where: { id: 337n }, data: { product_id: 52n, unidad_compra: 'bolsa', contenido_compra: 500, cantidad_base: 1500, notas: 'Correccion: esta linea corresponde a Mozzarella para pizzas, no a Manchego.' } });
    await tx.purchases.update({ where: { id: PURCHASE }, data: { notas: `${purchase.notas ?? ''} | Correccion 2026-09-08: la linea 3 x 500 g ($219) se reclasifico de Manchego a Mozzarella; se conserva el historial FIFO y se reubican sus consumos.` } });

    await tx.inventory_lots.update({ where: { id: WRONG_LOT }, data: { cantidad_inicial: 500, cantidad_restante: Number(wrongLot.cantidad_restante) - 1500, costo_unitario: 0.184, notas: 'Lote corregido: compra 32 conserva 1 bloque de Manchego (500 g); la linea de 3 bolsas fue reclasificada a Mozzarella.' } });
    const newLot = await tx.inventory_lots.create({ data: { negocio_id: N, product_id: 52n, purchase_id: PURCHASE, recibido_at: purchase.fecha_recepcion, cantidad_inicial: 1500, cantidad_restante: 1500 - consumedQty, costo_unitario: 0.146, moneda: 'MXN', fuente: 'ticket_movil', ticket_ref: TICKET, notas: 'Lote corregido de la compra 32: 3 bolsas de Mozzarella de 500 g ($219). Los consumos de semana 36 se reclasifican desde el lote inicial provisional.' } });
    for (const row of consumed) await tx.inventory_consumptions.update({ where: { id: row.id }, data: { lote_id: newLot.id, costo_unitario: 0.146, costo_total: Math.round(Number(row.cantidad) * 0.146 * 10000) / 10000 } });
    await tx.inventory_lots.update({ where: { id: OLD_OPENING_LOT }, data: { cantidad_restante: 0, estado: 'cancelado', notas: 'Cancelado por correccion de compra 32: la Mozzarella de semana 36 estaba registrada como Manchego. Consumos conservados y reclasificados al lote de compra.' } });
    return { alreadyApplied: false, purchaseId: PURCHASE, wrongLotId: WRONG_LOT, correctionLotId: newLot.id, consumedRows: consumed.length, consumedQty, wrongLotRemaining: Number(wrongLot.cantidad_restante) - 1500, correctionLotRemaining: 1500 - consumedQty };
  }, { maxWait: 60000, timeout: 120000 });
  console.log(json({ ok: true, result }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
