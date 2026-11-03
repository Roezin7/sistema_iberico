/** Shared presentation rules for the weekly operating cycle. */
export interface OperatingWeek {
  etiqueta?: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado?: string;
}

/**
 * The API already normalizes week labels. Keeping this in one place prevents
 * each screen from falling back to an opaque date or database id.
 */
export function weekLabel(week: OperatingWeek): string {
  const canonical = week.etiqueta?.trim();
  if (canonical && canonical.includes('(') && canonical.includes('→')) return canonical;
  const number = canonical?.match(/\d+/)?.[0];
  return `${number ? `Semana ${number}` : 'Semana'} (${week.fecha_inicio} → ${week.fecha_fin})`;
}

export function weekStateLabel(week: OperatingWeek): string {
  return week.estado === 'cerrada' ? 'Cerrada' : 'Abierta';
}

/** Local Mexico date, avoiding UTC shifting around midnight. */
export function todayMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

/** datetime-local siempre representa México, no la zona del dispositivo. */
export function inputHoraMexico(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(' ', 'T') : '';
}
export function isoDesdeHoraMexico(input: string): string | null {
  return input ? new Date(`${input}-06:00`).toISOString() : null;
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 3): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-MX', { maximumFractionDigits });
}

export function baseQuantityLabel(args: {
  quantity: number | null | undefined;
  sourceUnit: string | null | undefined;
  baseUnit: string | null | undefined;
  factor: number | null | undefined;
}): string | null {
  if (args.quantity == null || args.factor == null || !Number.isFinite(args.factor)) return null;
  const base = args.quantity * args.factor;
  return `${formatNumber(base)} ${args.baseUnit ?? 'unidad base'}`;
}
