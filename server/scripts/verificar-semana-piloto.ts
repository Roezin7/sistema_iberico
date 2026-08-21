import { PrismaClient } from '@prisma/client';

/**
 * Reporte de solo lectura para iniciar una semana real. No crea snapshots,
 * no importa Epos y no modifica compras, ventas ni inventario.
 */
const prisma = new PrismaClient();
const negocioId = 1n;
const semanaId = BigInt(process.argv[2] ?? 64);

async function main() {
  const semana = await prisma.semanas.findUnique({
    where: { id: semanaId },
    select: { id: true, etiqueta: true, fecha_inicio: true, fecha_fin: true, estado: true, inventario_semanal: true },
  });
  if (!semana) throw new Error(`Semana ${semanaId} no existe`);

  const fechaLocal = (value: Date) => value.toISOString().slice(0, 10);
  const from = new Date(`${fechaLocal(semana.fecha_inicio)}T00:00:00-06:00`);
  const to = new Date(`${fechaLocal(semana.fecha_fin)}T00:00:00-06:00`);
  const [ventas, conciliaciones, compras, excepciones, lotes] = await Promise.all([
    prisma.epos_ventas.groupBy({ by: ['costeo_estado'], where: { negocio_id: negocioId, fecha: { gte: from, lt: to } }, _count: { _all: true }, _sum: { venta_neta: true, costo_fifo: true } }),
    prisma.conciliaciones_diarias.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, select: { fecha: true, estado: true, epos_ventas: true } }),
    prisma.purchases.findMany({ where: { negocio_id: negocioId, fecha_recepcion: { gte: from, lt: to } }, select: { id: true, ticket_ref: true, estado: true, total: true, purchase_lines: { select: { product_id: true } }, capture_lines: { select: { id: true, tipo_linea: true, product_id: true } } } }),
    prisma.epos_ventas.findMany({ where: { negocio_id: negocioId, fecha: { gte: from, lt: to }, costeo_estado: 'excepcion' }, select: { producto_nombre: true, costeo_error: true } }),
    prisma.inventory_lots.aggregate({ where: { negocio_id: negocioId, fuente: 'inventario_inicial' }, _count: { _all: true }, _sum: { cantidad_restante: true } }),
  ]);

  const comprasPendientes = compras.filter((c) => c.estado !== 'confirmada' || c.purchase_lines.length === 0 || c.capture_lines.some((line) => line.tipo_linea === 'pendiente'));
  console.log(JSON.stringify({
    ok: true,
    semana: { id: semana.id.toString(), etiqueta: semana.etiqueta, inicio: semana.fecha_inicio.toISOString().slice(0, 10), fin: semana.fecha_fin.toISOString().slice(0, 10), estado: semana.estado },
    apertura: semana.inventario_semanal ? { snapshot_id: semana.inventario_semanal.apertura_snapshot_id?.toString() ?? null, valor: semana.inventario_semanal.apertura_valor } : null,
    ventas,
    conciliaciones,
    compras: { total: compras.length, pendientes_revision: comprasPendientes.map((c) => ({ id: c.id.toString(), ticket_ref: c.ticket_ref, estado: c.estado, total: c.total, lineas_fifo: c.purchase_lines.length, lineas_captura: c.capture_lines.length })) },
    excepciones,
    lotes_apertura: { count: lotes._count._all, cantidad_restante: lotes._sum.cantidad_restante },
  }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
