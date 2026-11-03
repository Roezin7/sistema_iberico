import type { Prisma, PrismaClient } from '@prisma/client';
import { costoBaseDesdePresentacion } from './logic.js';

type Db = Prisma.TransactionClient | PrismaClient;
type Referencia = { unit_cost: unknown; contenido_compra: unknown; unidad_base: string | null };
export type CostoHistorico = {
  id: bigint; fecha: Date; vigente_desde: Date | null; costo: unknown;
  contenido_compra: unknown; unidad_base: string | null;
};
const n = (v: unknown) => v == null ? null : Number(v);
export function seleccionarCostoHistorico(filas: CostoHistorico[], corte: Date): CostoHistorico | null {
  let result: CostoHistorico | null = null;
  let time = -Infinity;
  for (const row of filas) {
    const t = (row.vigente_desde ?? row.fecha).getTime();
    if (t > corte.getTime()) continue;
    if (t > time || t === time && result != null && row.id > result.id) { result = row; time = t; }
  }
  return result;
}
export function costoBaseHistorico(actual: Referencia, historico: CostoHistorico | null): number | null {
  return costoBaseDesdePresentacion({
    costoPresentacion: historico ? n(historico.costo) : n(actual.unit_cost),
    contenidoCompra: historico?.contenido_compra == null ? n(actual.contenido_compra) : n(historico.contenido_compra),
    unidadBase: historico?.unidad_base ?? actual.unidad_base,
  });
}

/** Única valoración de snapshots: cantidad y formato no dependen del catálogo de hoy. */
export async function valorSnapshotHistorico(db: Db, negocioId: bigint, snapshotId: bigint): Promise<number> {
  const snapshot = await db.inventory_snapshot.findFirst({ where: { id: snapshotId, negocio_id: negocioId }, select: { created_at: true } });
  if (!snapshot) return 0;
  const lines = await db.inventory_lines.findMany({ where: { snapshot_id: snapshotId, inventory_snapshot: { negocio_id: negocioId } }, include: { products: { select: { unit_cost: true, unidad_base: true, contenido_compra: true } } } });
  const ids = [...new Set(lines.map(l => l.product_id))];
  const history = ids.length ? await db.producto_costos_historicos.findMany({ where: { product_id: { in: ids } } }) : [];
  const byProduct = new Map<string, typeof history>();
  for (const h of history) { const key = h.product_id.toString(); const rows = byProduct.get(key) ?? []; rows.push(h); byProduct.set(key, rows); }
  return Math.round(lines.reduce((sum, l) => {
    const h = seleccionarCostoHistorico(byProduct.get(l.product_id.toString()) ?? [], snapshot.created_at);
    return sum + Number(l.qty_captura) * Number(l.factor) * (costoBaseHistorico(l.products, h) ?? 0);
  }, 0) * 100) / 100;
}

/** Guarda referencia legada y nuevo costo/formato en la misma transacción que el cambio.
 * La referencia inicial conserva el antiguo fallback del catálogo, no es una compra.
 */
export async function registrarCambioCostoCatalogo(db: Prisma.TransactionClient, antes: Referencia & { id: bigint }, despues: Referencia, instante: Date, fuente: string) {
  if (n(antes.unit_cost) === n(despues.unit_cost) && n(antes.contenido_compra) === n(despues.contenido_compra) && antes.unidad_base === despues.unidad_base) return;
  const baseline = await db.producto_costos_historicos.findFirst({ where: { product_id: antes.id, fuente: 'referencia_inicial_catalogo_no_ticket' } });
  if (!baseline) await db.producto_costos_historicos.create({ data: { product_id: antes.id, fecha: new Date(0), vigente_desde: new Date(0), costo: n(antes.unit_cost), contenido_compra: n(antes.contenido_compra), unidad_base: antes.unidad_base, fuente: 'referencia_inicial_catalogo_no_ticket' } });
  await db.producto_costos_historicos.create({ data: { product_id: antes.id, fecha: instante, vigente_desde: instante, costo: n(despues.unit_cost), contenido_compra: n(despues.contenido_compra), unidad_base: despues.unidad_base, fuente } });
}
