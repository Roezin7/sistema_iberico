import type { Prisma } from '@prisma/client';

/** Fuentes que representan consumo de venta vigente en el libro FIFO. */
export const FUENTES_FIFO_VENTA_ACTIVAS = [
  'venta_receta',
  'venta_receta_historica',
] as const;

/**
 * Una reversión nunca es consumo activo. Las correcciones de inventario se
 * incluyen sólo al reconstruir existencia de lotes, nunca al costo de ventas.
 */
export function esConsumoFifoActivo(
  row: { fuente: string | null; cantidad: unknown },
  options: { incluirAjustes?: boolean } = {},
): boolean {
  const fuente = row.fuente ?? '';
  const cantidad = Number(row.cantidad);
  if (!Number.isFinite(cantidad) || cantidad <= 0 || fuente.startsWith('reversion_')) return false;
  if (fuente.startsWith('venta_fifo_vivo')) return true;
  if ((FUENTES_FIFO_VENTA_ACTIVAS as readonly string[]).includes(fuente)) return true;
  return Boolean(options.incluirAjustes && fuente === 'ajuste_inventario');
}

/** Filtro Prisma único para cualquier consulta que reconstruya el libro FIFO. */
export function filtroConsumoFifoActivo(options: { incluirAjustes?: boolean } = {}): Prisma.inventory_consumptionsWhereInput {
  const fuentes: Prisma.inventory_consumptionsWhereInput[] = [
    { fuente: { startsWith: 'venta_fifo_vivo' } },
    { fuente: 'venta_receta' },
    { fuente: 'venta_receta_historica' },
  ];
  if (options.incluirAjustes) fuentes.push({ fuente: 'ajuste_inventario' });
  return { cantidad: { gt: 0 }, OR: fuentes };
}

export function esReversionFifo(row: { fuente: string | null }): boolean {
  return (row.fuente ?? '').startsWith('reversion_');
}
