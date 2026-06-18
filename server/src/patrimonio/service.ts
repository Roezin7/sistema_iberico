import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { patrimonioNeto, redondear } from './logic.js';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
//  Pasivos (CRUD)
// ---------------------------------------------------------------------------
export async function listarPasivos(negocioId: bigint) {
  const ps = await prisma.pasivos.findMany({ where: { negocio_id: negocioId }, orderBy: { id: 'asc' } });
  return ps.map((p) => ({ id: Number(p.id), nombre: p.nombre, monto: num0(p.monto), tipo: p.tipo, activo: p.activo }));
}

export async function sumaPasivosActivos(negocioId: bigint): Promise<number> {
  const ps = await prisma.pasivos.findMany({ where: { negocio_id: negocioId, activo: true } });
  return redondear(ps.reduce((a, p) => a + num0(p.monto), 0));
}

export async function crearPasivo(negocioId: bigint, b: { nombre: string; monto: number; tipo?: string | null }) {
  const p = await prisma.pasivos.create({
    data: { negocio_id: negocioId, nombre: b.nombre, monto: b.monto, tipo: b.tipo ?? null },
  });
  return { id: Number(p.id) };
}

export async function actualizarPasivo(negocioId: bigint, id: bigint, b: { nombre?: string; monto?: number; tipo?: string | null; activo?: boolean }) {
  const p = await prisma.pasivos.findFirst({ where: { id, negocio_id: negocioId } });
  if (!p) throw new HttpError(404, 'Pasivo no encontrado');
  await prisma.pasivos.update({ where: { id }, data: { nombre: b.nombre, monto: b.monto, tipo: b.tipo, activo: b.activo } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  Snapshots
// ---------------------------------------------------------------------------
export async function listarSnapshots(negocioId: bigint) {
  const ss = await prisma.snapshots_patrimonio.findMany({ where: { negocio_id: negocioId }, orderBy: { fecha: 'asc' } });
  return ss.map((s) => ({
    id: Number(s.id),
    fecha: iso(s.fecha),
    total_banco: num0(s.total_banco),
    total_efectivo: num0(s.total_efectivo),
    total_inventario: num0(s.total_inventario),
    total_pasivos: num0(s.total_pasivos),
    patrimonio_neto: num0(s.patrimonio_neto),
  }));
}

/** Tendencia: serie temporal del neto + desglose por componente y el último valor. */
export async function tendencia(negocioId: bigint) {
  const serie = await listarSnapshots(negocioId);
  const ultimo = serie.length ? serie[serie.length - 1]! : null;
  return { serie, ultimo };
}

/**
 * Genera el snapshot de patrimonio al cerrar una semana. Se llama DENTRO de la
 * transacción de cierre. Banco/efectivo vienen de los saldos finales por tipo de
 * ubicación; inventario del valor a costo actual; pasivos de los activos.
 */
export async function generarSnapshotEnCierre(
  tx: Prisma.TransactionClient,
  negocioId: bigint,
  fecha: Date,
  totalBanco: number,
  totalEfectivo: number,
  totalInventario: number, // precalculado FUERA de la tx (inventarioActual es una lectura pesada)
) {
  const pasivos = await tx.pasivos.findMany({ where: { negocio_id: negocioId, activo: true } });
  const totalPasivos = redondear(pasivos.reduce((a, p) => a + num0(p.monto), 0));
  const neto = patrimonioNeto(totalBanco, totalEfectivo, totalInventario, totalPasivos);

  await tx.snapshots_patrimonio.upsert({
    where: { negocio_id_fecha: { negocio_id: negocioId, fecha } },
    update: {
      total_banco: totalBanco, total_efectivo: totalEfectivo, total_inventario: totalInventario,
      total_pasivos: totalPasivos, patrimonio_neto: neto,
    },
    create: {
      negocio_id: negocioId, fecha, total_banco: totalBanco, total_efectivo: totalEfectivo,
      total_inventario: totalInventario, total_pasivos: totalPasivos, patrimonio_neto: neto,
    },
  });
  return { totalBanco, totalEfectivo, totalInventario, totalPasivos, neto };
}
