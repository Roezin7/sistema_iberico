import { Prisma } from '@prisma/client';

/** Un number en SQL raw viaja como float8: 0.56 puede llegar a NUMERIC como
 * 0.5600000000000001. Texto decimal exacto conserva la comparación estricta. */
export function decimalSql(value: number | string | Prisma.Decimal, escala = 4): string {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite()) throw new Error('Cantidad decimal no finita');
  return decimal.toFixed(escala);
}
