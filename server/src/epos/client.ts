import { env } from '../env.js';
import { HttpError } from '../middleware/error.js';

type JsonRecord = Record<string, unknown>;

export interface EposReportRow {
  Product?: string | null;
  ProductID?: number | null;
  ProductId?: number | null;
  DateTime?: string | null;
  Quantity?: number | null;
  TotalSales?: number | null;
  NetSales?: number | null;
  Discount?: number | null;
  DiscountValue?: number | null;
  Tender?: string | null;
  TransactionID?: number | null;
  TransactionItemID?: number | null;
  [key: string]: unknown;
}

/** Epos ha usado ambas variantes de capitalización en sus reportes. */
export function eposProductId(row: Pick<EposReportRow, 'ProductID' | 'ProductId'>) {
  const value = row.ProductID ?? row.ProductId;
  return Number.isFinite(value) ? Number(value) : null;
}

export function eposDiscount(row: Pick<EposReportRow, 'Discount' | 'DiscountValue'>) {
  return numberOrZero(row.Discount ?? row.DiscountValue);
}

export interface EposDailySalesRow {
  ItemQty?: number | null;
  Value?: number | null;
  ValueIncVAT?: number | null;
  ValueExcVAT?: number | null;
  NoOfTrans?: number | null;
  Discount?: number | null;
  RefundQty?: number | null;
  RefundValue?: number | null;
  [key: string]: unknown;
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function config() {
  if (!env.EPOS_API_KEY || !env.EPOS_API_SECRET) {
    throw new HttpError(503, 'Epos Now no está configurado en el servidor');
  }
  return env;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const c = config();
  const configuredBase = c.EPOS_API_BASE_URL.replace(/\/+$/, '');
  const apiBase = /\/api$/i.test(configuredBase) ? configuredBase : `${configuredBase}/api`;
  const url = new URL(`${apiBase}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const token = Buffer.from(`${c.EPOS_API_KEY}:${c.EPOS_API_SECRET}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), c.EPOS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new HttpError(502, `Epos Now respondió ${response.status}`, { status: response.status, body: body.slice(0, 500) });
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'Tiempo agotado al consultar Epos Now');
    }
    throw new HttpError(502, 'No se pudo consultar Epos Now');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Epos Now interpreta FromDate/ToDate como hora local de la cuenta y no
 * admite de forma consistente un sufijo ISO con zona horaria. Cuando recibe
 * `-06:00` puede omitir las ventas cercanas al cambio de día. Conservamos la
 * hora local indicada por la aplicación y retiramos únicamente el sufijo al
 * construir la consulta; las fechas persistidas siguen llevando zona.
 */
export function fechaConsultaEpos(value: string) {
  return value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '');
}

export async function dailySales(from: string, to: string, locationId?: number) {
  return get<EposDailySalesRow[]>('V2/DailySales', {
    FromDate: fechaConsultaEpos(from),
    ToDate: fechaConsultaEpos(to),
    LocationID: locationId ?? env.EPOS_LOCATION_ID,
  });
}

export async function bookkeepingReport(from: string, to: string, locationId?: number) {
  return get<EposReportRow[]>('Reports/BookkeepingReport', {
    FromDate: fechaConsultaEpos(from),
    ToDate: fechaConsultaEpos(to),
    LocationID: locationId ?? env.EPOS_LOCATION_ID,
    ExtendedDetails: 1,
  });
}

export function summarizeBookkeeping(rows: EposReportRow[]) {
  const transactions = new Set(rows.map((r) => r.TransactionID).filter((id): id is number => Number.isFinite(id)));
  const products = new Map<string, { nombre: string; product_id: number | null; cantidad: number; ventas: number }>();
  const tenders = new Map<string, number>();
  const daily = new Map<string, { fecha: string; transacciones: Set<number>; unidades: number; ventas: number; metodos: Map<string, number> }>();
  for (const row of rows) {
    const productId = eposProductId(row);
    const productName = String(row.Product ?? 'SIN_PRODUCTO');
    const key = `${productId ?? 'nombre'}:${productName}`;
    const current = products.get(key) ?? { nombre: productName, product_id: productId, cantidad: 0, ventas: 0 };
    current.cantidad += numberOrZero(row.Quantity);
    current.ventas += numberOrZero(row.TotalSales ?? row.NetSales);
    products.set(key, current);
    const tender = String(row.Tender ?? 'SIN_METODO');
    tenders.set(tender, (tenders.get(tender) ?? 0) + numberOrZero(row.TotalSales ?? row.NetSales));
    const date = typeof row.DateTime === 'string' && row.DateTime.length >= 10 ? row.DateTime.slice(0, 10) : 'SIN_FECHA';
    const day = daily.get(date) ?? { fecha: date, transacciones: new Set<number>(), unidades: 0, ventas: 0, metodos: new Map<string, number>() };
    if (Number.isFinite(row.TransactionID)) day.transacciones.add(row.TransactionID!);
    day.unidades += numberOrZero(row.Quantity);
    day.ventas += numberOrZero(row.TotalSales ?? row.NetSales);
    day.metodos.set(tender, (day.metodos.get(tender) ?? 0) + numberOrZero(row.TotalSales ?? row.NetSales));
    daily.set(date, day);
  }
  return {
    filas: rows.length,
    transacciones: transactions.size,
    unidades: rows.reduce((sum, row) => sum + numberOrZero(row.Quantity), 0),
    ventas: rows.reduce((sum, row) => sum + numberOrZero(row.TotalSales ?? row.NetSales), 0),
    productos: [...products.values()],
    metodos_pago: [...tenders.entries()].map(([metodo, total]) => ({ metodo, total })),
    dias: [...daily.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((day) => ({
      fecha: day.fecha,
      transacciones: day.transacciones.size,
      unidades: day.unidades,
      ventas: day.ventas,
      metodos_pago: [...day.metodos.entries()].map(([metodo, total]) => ({ metodo, total })),
    })),
  };
}

export function summarizeDailySales(rows: EposDailySalesRow[]) {
  // Algunas cuentas/reportes de Epos devuelven ventas y descuentos, pero dejan
  // NoOfTrans e ItemQty vacíos. No convertir esos campos ausentes en cero:
  // cero sería un dato falso y produciría diferencias artificiales contra
  // Bookkeeping.
  const tieneTransacciones = rows.some((row) => row.NoOfTrans !== null && row.NoOfTrans !== undefined);
  const tieneUnidades = rows.some((row) => row.ItemQty !== null && row.ItemQty !== undefined);
  return {
    filas: rows.length,
    transacciones: tieneTransacciones ? rows.reduce((sum, row) => sum + numberOrZero(row.NoOfTrans), 0) : null,
    unidades: tieneUnidades ? rows.reduce((sum, row) => sum + numberOrZero(row.ItemQty), 0) : null,
    ventas: rows.reduce((sum, row) => sum + numberOrZero(row.ValueIncVAT ?? row.Value), 0),
    descuentos: rows.reduce((sum, row) => sum + eposDiscount(row), 0),
    devoluciones: rows.reduce((sum, row) => sum + numberOrZero(row.RefundValue), 0),
  };
}

export async function fetchReconcileData(from: string, to: string, locationId?: number) {
  const [daily, bookkeeping] = await Promise.all([
    dailySales(from, to, locationId),
    bookkeepingReport(from, to, locationId),
  ]);
  return { daily, bookkeeping };
}

export function buildReconcilePreview(
  from: string,
  to: string,
  dailySummary: ReturnType<typeof summarizeDailySales>,
  bookkeepingSummary: ReturnType<typeof summarizeBookkeeping>,
) {
  return {
    periodo: { from, to },
    fuente: 'Epos Now',
    lectura: true,
    daily_sales: dailySummary,
    bookkeeping: bookkeepingSummary,
    diferencias: {
      ventas: Math.round((dailySummary.ventas - bookkeepingSummary.ventas) * 100) / 100,
      unidades: dailySummary.unidades == null ? null : dailySummary.unidades - bookkeepingSummary.unidades,
      transacciones: dailySummary.transacciones == null ? null : dailySummary.transacciones - bookkeepingSummary.transacciones,
    },
  };
}

export async function reconcilePreview(from: string, to: string, locationId?: number) {
  const { daily, bookkeeping } = await fetchReconcileData(from, to, locationId);
  const dailySummary = summarizeDailySales(daily);
  const bookkeepingSummary = summarizeBookkeeping(bookkeeping);
  return buildReconcilePreview(from, to, dailySummary, bookkeepingSummary);
}
