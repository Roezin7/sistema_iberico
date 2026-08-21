import { PrismaClient } from '@prisma/client';
import { consumirVentasEpos } from '../src/inventario/consumo-epos.js';

/**
 * Completa únicamente la isla histórica de la semana 63. Estos lotes no son
 * compras: representan inventario inicial no contabilizado que ya había sido
 * acordado como regularización explícita del piloto. La semana 64 se verifica
 * antes y después para impedir que este ejercicio afecte producción.
 */
const prisma = new PrismaClient();
const negocioId = 1n;
const from = '2026-08-10T00:00:00.000Z';
const to = '2026-08-17T00:00:00.000Z';
const adjustmentRef = 'AJUSTE-FALTANTES-63';
const adjustmentRef2 = 'AJUSTE-FALTANTES-63-2';

const ajustes = [
  { productId: 81n, producto: 'Limón', cantidad: 59.5, costoUnitario: 30 / 14, unidad: 'pieza' },
  { productId: 92n, producto: 'Piña', cantidad: 240, costoUnitario: 40 / 1000, unidad: 'g' },
  { productId: 97n, producto: 'Michemix', cantidad: 60, costoUnitario: 89 / 1000, unidad: 'ml' },
  { productId: 85n, producto: 'Perejil', cantidad: 2, costoUnitario: 5 / 50, unidad: 'pieza' },
  { productId: 84n, producto: 'Pepino', cantidad: 60, costoUnitario: 15 / 1000, unidad: 'g' },
  { productId: 82n, producto: 'Agua natural', cantidad: 1200, costoUnitario: 27 / 5000, unidad: 'ml' },
  { productId: 87n, producto: 'Carnation', cantidad: 236.6, costoUnitario: 61 / 1000, unidad: 'ml' },
  { productId: 96n, producto: 'Viuda de Sánchez', cantidad: 29.57, costoUnitario: 100 / 1000, unidad: 'ml' },
  { productId: 13n, producto: 'Arriero', cantidad: 212.64, costoUnitario: 160 / 1000, unidad: 'ml' },
  { productId: 54n, producto: 'Fresas', cantidad: 80, costoUnitario: 80 / 1810, unidad: 'g' },
  { productId: 52n, producto: 'Mozzarella', cantidad: 480, costoUnitario: 75 / 500, unidad: 'g' },
  { productId: 93n, producto: 'Saborizante tamarindo', cantidad: 88.71, costoUnitario: 70 / 700, unidad: 'ml' },
  { productId: 86n, producto: 'Lechera', cantidad: 118.28, costoUnitario: 50 / 257.95, unidad: 'ml' },
];

// Al desbloquear recetas que antes fallaban por otro ingrediente, el motor
// revela el remanente de consumo de limón/agua y la variante real de horchata.
// Se conserva como una segunda regularización auditable, no se modifica el
// lote original.
const ajustesRevelados = [
  { productId: 81n, producto: 'Limón', cantidad: 9.5, costoUnitario: 30 / 14, unidad: 'pieza' },
  { productId: 82n, producto: 'Agua natural', cantidad: 1000, costoUnitario: 27 / 5000, unidad: 'ml' },
  { productId: 91n, producto: 'Concentrado de horchata', cantidad: 118.28, costoUnitario: 50 / 700, unidad: 'ml' },
];

async function main() {
  const eposIds = (await prisma.epos_ventas.findMany({
    where: { negocio_id: negocioId, fecha: { gte: new Date(from), lt: new Date(to) } },
    select: { id: true },
  })).map((v) => v.id);

  const week64LotsBefore = await prisma.inventory_lots.findMany({
    where: { negocio_id: negocioId, fuente: 'inventario_inicial' },
    select: { id: true, cantidad_restante: true },
  });
  const signature = JSON.stringify(week64LotsBefore.map((l) => [l.id.toString(), Number(l.cantidad_restante)]));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.inventory_lots.findMany({
      where: { negocio_id: negocioId, fuente: 'historico_prueba', ticket_ref: adjustmentRef },
      select: { id: true, product_id: true, cantidad_inicial: true },
    });
    const existingIds = new Set(existing.map((row) => row.product_id.toString()));
    const missing = ajustes.filter((a) => !existingIds.has(a.productId.toString()));
    if (missing.length) {
      await tx.inventory_lots.createMany({
        data: missing.map((a) => ({
          negocio_id: negocioId,
          product_id: a.productId,
          purchase_id: null,
          recibido_at: new Date('2026-08-10T00:00:00.000Z'),
          cantidad_inicial: a.cantidad,
          cantidad_restante: a.cantidad,
          costo_unitario: a.costoUnitario,
          moneda: 'MXN',
          fuente: 'historico_prueba',
          ticket_ref: adjustmentRef,
          notas: `Regularización explícita de inventario inicial no contabilizado para el piloto; ${a.producto} en ${a.unidad}.`,
        })),
      });
    }

    const existingRevealed = await tx.inventory_lots.findMany({
      where: { negocio_id: negocioId, fuente: 'historico_prueba', ticket_ref: adjustmentRef2 },
      select: { product_id: true },
    });
    const revealedIds = new Set(existingRevealed.map((row) => row.product_id.toString()));
    const missingRevealed = ajustesRevelados.filter((a) => !revealedIds.has(a.productId.toString()));
    if (missingRevealed.length) {
      await tx.inventory_lots.createMany({
        data: missingRevealed.map((a) => ({
          negocio_id: negocioId,
          product_id: a.productId,
          purchase_id: null,
          recibido_at: new Date('2026-08-10T00:00:00.000Z'),
          cantidad_inicial: a.cantidad,
          cantidad_restante: a.cantidad,
          costo_unitario: a.costoUnitario,
          moneda: 'MXN',
          fuente: 'historico_prueba',
          ticket_ref: adjustmentRef2,
          notas: `Regularización revelada al desbloquear recetas durante el piloto; ${a.producto} en ${a.unidad}.`,
        })),
      });
    }

    // El recálculo debe partir de la apertura completa; de lo contrario un
    // segundo intento descontaría dos veces los lotes históricos.
    const historicos = await tx.inventory_lots.findMany({
      where: { negocio_id: negocioId, fuente: 'historico_prueba' },
      select: { id: true, cantidad_inicial: true },
    });
    for (const lote of historicos) {
      await tx.inventory_lots.update({ where: { id: lote.id }, data: { cantidad_restante: lote.cantidad_inicial, estado: 'abierto' } });
    }

    // Recalcular sólo ventas históricas. Las compras y movimientos ya existen;
    // no se crean ni se modifican movimientos financieros.
    if (eposIds.length) {
      await tx.inventory_consumptions.deleteMany({ where: { negocio_id: negocioId, epos_venta_id: { in: eposIds }, fuente: 'venta_receta_historica' } });
      await tx.epos_ventas.updateMany({
        where: { negocio_id: negocioId, id: { in: eposIds } },
        data: { costo_fifo: null, costeo_estado: 'pendiente', costeo_error: null, costeado_at: null },
      });
    }
  }, { timeout: 60_000 });

  const resultado = await consumirVentasEpos({ negocioId, from, to, confirmar: true, modo: 'historico_prueba' });
  const week64LotsAfter = await prisma.inventory_lots.findMany({
    where: { negocio_id: negocioId, fuente: 'inventario_inicial' },
    select: { id: true, cantidad_restante: true },
  });
  const intacta = signature === JSON.stringify(week64LotsAfter.map((l) => [l.id.toString(), Number(l.cantidad_restante)]));
  if (!intacta) throw new Error('La regularización histórica alteró lotes de la semana 64');

  const [costeadas, excepciones, totalCosto] = await Promise.all([
    prisma.epos_ventas.count({ where: { negocio_id: negocioId, fecha: { gte: new Date(from), lt: new Date(to) }, costeo_estado: 'costeada' } }),
    prisma.epos_ventas.findMany({ where: { negocio_id: negocioId, fecha: { gte: new Date(from), lt: new Date(to) }, costeo_estado: 'excepcion' }, select: { producto_nombre: true, costeo_error: true } }),
    prisma.epos_ventas.aggregate({ where: { negocio_id: negocioId, fecha: { gte: new Date(from), lt: new Date(to) } }, _sum: { costo_fifo: true } }),
  ]);
  console.log(JSON.stringify({ ok: true, resultado: { ventas: resultado.ventas, costeadas: resultado.costeadas, excepciones: resultado.excepciones, costo_fifo: resultado.costo_fifo }, costeadas, excepciones: excepciones.length, detalle_excepciones: excepciones, ajustes, semana64_intacta: intacta, costo_total_db: totalCosto._sum.costo_fifo }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
