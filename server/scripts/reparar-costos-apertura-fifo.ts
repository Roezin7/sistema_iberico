import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { costoUnitarioBaseDesdeCatalogo, conversionAperturaDesdeCatalogo } from '../src/inventario/apertura-fifo.js';

/**
 * Repara el único error conocido de la primera migración FIFO: las aperturas
 * normales antiguas guardaron el precio de la presentación como si fuera el
 * precio de cada gramo/ml/pieza. El script es de sólo lectura por defecto.
 * Ejecutar con --apply después de respaldar la base.
 */
const prisma = new PrismaClient();
const aplicar = process.argv.includes('--apply');

async function main() {
  const lotes = await prisma.inventory_lots.findMany({
    where: {
      fuente: 'inventario_inicial',
      purchase_id: null,
      ticket_ref: { startsWith: 'APERTURA-FIFO-' },
    },
    include: { products: { select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true, rendimiento_util: true } } },
    orderBy: [{ product_id: 'asc' }, { recibido_at: 'asc' }, { id: 'asc' }],
  });

  const candidatos = lotes.flatMap((lote) => {
    const precioCatalogo = lote.products.unit_cost == null ? null : Number(lote.products.unit_cost);
    const costoActual = Number(lote.costo_unitario);
    const contenido = lote.products.contenido_compra == null ? null : Number(lote.products.contenido_compra);
    const esperado = precioCatalogo == null ? null : costoUnitarioBaseDesdeCatalogo({
      costoPresentacion: precioCatalogo,
      contenidoCompra: contenido,
      rendimientoUtil: lote.products.rendimiento_util == null ? 1 : Number(lote.products.rendimiento_util),
    });
    const cantidadNueva = contenido == null ? null : conversionAperturaDesdeCatalogo({
      cantidadPresentaciones: Number(lote.cantidad_inicial),
      contenidoCompra: contenido,
      rendimientoUtil: lote.products.rendimiento_util == null ? 1 : Number(lote.products.rendimiento_util),
      modo: 'normal',
    });
    // Sólo corregimos lotes que aún tienen exactamente el precio de catálogo,
    // firma de la apertura antigua. Un lote ya corregido manualmente queda
    // intacto para no pisar una decisión histórica.
    if (esperado == null || cantidadNueva == null || precioCatalogo == null || contenido == null || contenido <= 1) return [];
    if (Math.abs(costoActual - precioCatalogo) > 0.000001) return [];
    return [{ lote, producto: lote.products.name, costoActual, esperado, cantidadAnterior: Number(lote.cantidad_inicial), cantidadNueva }];
  });

  const resumen = candidatos.map((c) => ({
    lote_id: Number(c.lote.id), producto: c.producto, cantidad_anterior: c.cantidadAnterior,
    cantidad_nueva: c.cantidadNueva,
    costo_anterior: c.costoActual, costo_nuevo: Number(c.esperado!.toFixed(6)),
    valor_anterior: Number((c.cantidadAnterior * c.costoActual).toFixed(2)),
    valor_nuevo: Number((c.cantidadNueva * c.esperado!).toFixed(2)),
  }));
  if (!aplicar) {
    console.log(JSON.stringify({ modo: 'simulacion', candidatos: resumen, siguiente_paso: 'npm run fifo:repair-opening --workspace server -- --apply' }, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    const lotIds = candidatos.map((c) => c.lote.id);
    if (!lotIds.length) return;
    for (const c of candidatos) {
      const consumido = await tx.inventory_consumptions.aggregate({ where: { lote_id: c.lote.id }, _sum: { cantidad: true } });
      const restante = Math.max(0, c.cantidadNueva - Number(consumido._sum.cantidad ?? 0));
      await tx.inventory_lots.update({ where: { id: c.lote.id }, data: {
        cantidad_inicial: c.cantidadNueva,
        cantidad_restante: restante,
        costo_unitario: c.esperado,
        estado: restante <= 0.0001 ? 'agotado' : 'abierto',
      } });
      const consumos = await tx.inventory_consumptions.findMany({ where: { lote_id: c.lote.id }, select: { id: true, cantidad: true, epos_venta_id: true } });
      for (const consumo of consumos) {
        await tx.inventory_consumptions.update({ where: { id: consumo.id }, data: { costo_unitario: c.esperado, costo_total: Number(consumo.cantidad) * c.esperado! } });
      }
    }

    // Los costos históricos de ventas se derivan del ledger de consumos. Se
    // recalculan sólo las ventas tocadas por un lote reparado.
    const consumosVentas = await tx.inventory_consumptions.findMany({ where: { lote_id: { in: lotIds }, epos_venta_id: { not: null } }, select: { epos_venta_id: true } });
    const ventaIds = [...new Set(consumosVentas.flatMap((row) => row.epos_venta_id == null ? [] : [row.epos_venta_id]))];
    for (const ventaId of ventaIds) {
      const total = await tx.inventory_consumptions.aggregate({ where: { epos_venta_id: ventaId }, _sum: { costo_total: true } });
      await tx.epos_ventas.update({ where: { id: ventaId }, data: { costo_fifo: total._sum.costo_total ?? 0 } });
    }
  }, { timeout: 120_000 });

  console.log(JSON.stringify({ modo: 'aplicado', corregidos: resumen.length, lotes: resumen, ventas_recalculadas: 'incluidas en el ledger' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
