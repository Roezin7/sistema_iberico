import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import {
  buildReconcilePreview,
  fetchReconcileData,
  summarizeBookkeeping,
  summarizeDailySales,
  eposDiscount,
  eposProductId,
  type EposReportRow,
} from './client.js';

function fechaDeFila(row: EposReportRow, fallback: string) {
  const raw = typeof row.DateTime === 'string' && row.DateTime ? row.DateTime : fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return new Date(fallback);
  return date;
}

function numero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function claveFila(row: EposReportRow, fallback: string, occurrence: number) {
  const identity = [
    row.TransactionID ?? '', row.TransactionItemID ?? '', row.DateTime ?? fallback,
    eposProductId(row) ?? row.Product ?? 'SIN_PRODUCTO', row.Quantity ?? '',
    row.TotalSales ?? row.NetSales ?? '', row.Tender ?? 'SIN_METODO', occurrence,
  ].join('|');
  return `row:${createHash('sha256').update(identity).digest('hex')}`;
}

/** Importa el BookkeepingReport de forma idempotente. No modifica inventario,
 * recetas, gastos ni conciliaciones confirmadas. */
export async function importarVentasEpos(input: {
  negocioId: bigint;
  from: string;
  to: string;
  locationId?: number;
}) {
  const fromDate = new Date(input.from);
  const toDate = new Date(input.to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    throw new HttpError(400, 'Periodo inválido');
  }

  const { daily, bookkeeping } = await fetchReconcileData(input.from, input.to, input.locationId);
  const dailySummary = summarizeDailySales(daily);
  const bookkeepingSummary = summarizeBookkeeping(bookkeeping);
  const preview = buildReconcilePreview(input.from, input.to, dailySummary, bookkeepingSummary);
  const claveImportacion = `${input.locationId ?? 0}:${input.from}:${input.to}`;
  const occurrence = new Map<string, number>();
  const filasPreparadas = bookkeeping.map((row) => {
    const productName = String(row.Product ?? 'SIN_PRODUCTO').trim() || 'SIN_PRODUCTO';
    const productId = eposProductId(row);
    const occurrenceKey = [row.TransactionID ?? '', row.TransactionItemID ?? '', row.DateTime ?? '', productId ?? productName, row.Quantity ?? '', row.TotalSales ?? row.NetSales ?? '', row.Tender ?? 'SIN_METODO'].join('|');
    const count = occurrence.get(occurrenceKey) ?? 0;
    occurrence.set(occurrenceKey, count + 1);
    return {
      clave: claveFila(row, input.from, count),
      epos_transaction_id: Number.isFinite(row.TransactionID) ? row.TransactionID : null,
      epos_item_id: Number.isFinite(row.TransactionItemID) ? row.TransactionItemID : null,
      fecha: fechaDeFila(row, input.from),
      epos_product_id: productId,
      producto_nombre: productName,
      cantidad: numero(row.Quantity),
      venta_bruta: numero(row.TotalSales ?? row.NetSales),
      venta_neta: row.NetSales == null ? null : numero(row.NetSales),
      descuento: eposDiscount(row),
      metodo_pago: String(row.Tender ?? 'SIN_METODO'),
      raw_json: JSON.stringify(row),
    };
  });

  const result = await prisma.$transaction(async (tx) => {
    const existingImport = await tx.epos_importaciones.findUnique({
      where: { negocio_id_clave: { negocio_id: input.negocioId, clave: claveImportacion } },
    });
    const importacion = existingImport
      ? await tx.epos_importaciones.update({
          where: { id: existingImport.id },
          data: {
            location_id: input.locationId, periodo_desde: fromDate, periodo_hasta: toDate,
            estado: 'completada', filas_recibidas: bookkeeping.length,
            payload_json: JSON.stringify({ daily, bookkeeping }),
          },
        })
      : await tx.epos_importaciones.create({
          data: {
            negocio_id: input.negocioId, clave: claveImportacion, location_id: input.locationId,
            periodo_desde: fromDate, periodo_hasta: toDate, filas_recibidas: bookkeeping.length,
            payload_json: JSON.stringify({ daily, bookkeeping }),
          },
        });

    const existentes = await tx.epos_ventas.findMany({
      where: { negocio_id: input.negocioId, clave: { in: filasPreparadas.map((fila) => fila.clave) } },
      select: { clave: true },
    });
    const clavesExistentes = new Set(existentes.map((fila) => fila.clave));
    const nuevasData = filasPreparadas
      .filter((fila) => !clavesExistentes.has(fila.clave))
      .map((fila) => ({ negocio_id: input.negocioId, importacion_id: importacion.id, ...fila }));
    if (nuevasData.length) await tx.epos_ventas.createMany({ data: nuevasData, skipDuplicates: true });
    const nuevas = nuevasData.length;
    const duplicadas = filasPreparadas.length - nuevas;
    await tx.epos_importaciones.update({ where: { id: importacion.id }, data: { filas_nuevas: nuevas, filas_duplicadas: duplicadas } });
    return { importacion, nuevas, duplicadas };
  }, { maxWait: 20_000, timeout: 120_000 });

  return {
    ...preview, persistido: true, importacion_id: Number(result.importacion.id),
    filas_persistidas: result.nuevas, filas_duplicadas: result.duplicadas,
    nota: 'Las ventas importadas son evidencia de Epos; no descuentan inventario hasta confirmar recetas y el corte diario.',
  };
}

export async function listarImportacionesEpos(negocioId: bigint, limite = 20) {
  const rows = await prisma.epos_importaciones.findMany({ where: { negocio_id: negocioId }, orderBy: { creado_at: 'desc' }, take: Math.min(Math.max(limite, 1), 100) });
  return rows.map((row) => ({
    id: Number(row.id), clave: row.clave, location_id: row.location_id,
    periodo: { from: row.periodo_desde.toISOString(), to: row.periodo_hasta.toISOString() },
    estado: row.estado, filas_recibidas: row.filas_recibidas, filas_nuevas: row.filas_nuevas,
    filas_duplicadas: row.filas_duplicadas, creado_at: row.creado_at.toISOString(),
  }));
}

export async function listarVentasEpos(input: { negocioId: bigint; from?: string; to?: string; limite?: number }) {
  const from = input.from ? new Date(input.from) : undefined;
  const to = input.to ? new Date(input.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new HttpError(400, 'Periodo inválido');
  }
  const rows = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: input.negocioId,
      ...(from || to ? { fecha: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(input.limite ?? 5000, 1), 20000),
  });
  return rows.map((row) => ({
    id: Number(row.id), importacion_id: Number(row.importacion_id), fecha: row.fecha.toISOString(),
    epos_transaction_id: row.epos_transaction_id, epos_item_id: row.epos_item_id,
    epos_product_id: row.epos_product_id, producto: row.producto_nombre,
    cantidad: Number(row.cantidad), venta_bruta: Number(row.venta_bruta),
    venta_neta: row.venta_neta == null ? null : Number(row.venta_neta),
    descuento: Number(row.descuento), metodo_pago: row.metodo_pago,
    costo_fifo: row.costo_fifo == null ? null : Number(row.costo_fifo),
    costeo_estado: row.costeo_estado,
    costeo_error: row.costeo_error,
  }));
}

export async function listarExcepcionesEpos(input: { negocioId: bigint; from?: string; to?: string }) {
  const from = input.from ? new Date(input.from) : undefined;
  const to = input.to ? new Date(input.to) : undefined;
  const rows = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: input.negocioId,
      costeo_estado: 'excepcion',
      ...(from || to ? { fecha: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    take: 1000,
  });
  return rows.map((row) => ({
    venta_id: Number(row.id),
    fecha: row.fecha.toISOString(),
    producto: row.producto_nombre,
    cantidad: Number(row.cantidad),
    error: row.costeo_error ?? 'Revisión pendiente',
  }));
}
