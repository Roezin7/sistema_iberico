import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { num0 } from '../lib/num.js';
import { bloquearLibro } from '../inventario/control-cierre.js';
import { fechaCivilUTC } from '../lib/fechas.js';
import { escribirDiaEnTx, type DiaInput } from '../finanzas/service.js';

export interface DailyReconciliationInput {
  negocioId: bigint;
  usuarioId: bigint;
  semanaId: bigint;
  fecha: string;
  epos: { ventas: number; efectivo: number; tarjeta: number; otros: number };
  confirmado: { ventas: number; efectivo: number; tarjeta: number; otros: number };
  cuentasAbiertas: number;
  excepciones: unknown[];
  notas?: string;
  diario?: DiaInput;
}

function fechaUtc(fecha: string) {
  return fechaCivilUTC(fecha);
}

function salida(row: {
  id: bigint; negocio_id: bigint; semana_id: bigint; fecha: Date; estado: string;
  epos_ventas: unknown; epos_efectivo: unknown; epos_tarjeta: unknown; epos_otros: unknown;
  confirmado_ventas: unknown; confirmado_efectivo: unknown; confirmado_tarjeta: unknown; confirmado_otros: unknown;
  cuentas_abiertas: unknown; excepciones_json: string | null; notas: string | null; usuario_id: bigint | null; confirmado_at: Date | null;
}) {
  const epos = { ventas: num0(row.epos_ventas as never), efectivo: num0(row.epos_efectivo as never), tarjeta: num0(row.epos_tarjeta as never), otros: num0(row.epos_otros as never) };
  const confirmado = { ventas: num0(row.confirmado_ventas as never), efectivo: num0(row.confirmado_efectivo as never), tarjeta: num0(row.confirmado_tarjeta as never), otros: num0(row.confirmado_otros as never) };
  const diferencia = {
    ventas: confirmado.ventas - epos.ventas,
    efectivo: confirmado.efectivo - epos.efectivo,
    tarjeta: confirmado.tarjeta - epos.tarjeta,
    otros: confirmado.otros - epos.otros,
    total: confirmado.ventas - epos.ventas,
    reconciliada: ['ventas', 'efectivo', 'tarjeta', 'otros'].every(k => Math.abs(confirmado[k as keyof typeof confirmado] - epos[k as keyof typeof epos]) <= 0.01),
  };
  return {
    id: Number(row.id), negocio_id: Number(row.negocio_id), semana_id: Number(row.semana_id),
    fecha: row.fecha.toISOString().slice(0, 10), estado: row.estado,
    epos, confirmado, diferencia,
    cuentas_abiertas: num0(row.cuentas_abiertas as never),
    excepciones: row.excepciones_json ? JSON.parse(row.excepciones_json) : [],
    notas: row.notas,
    usuario_id: row.usuario_id ? Number(row.usuario_id) : null,
    confirmado_at: row.confirmado_at?.toISOString() ?? null,
  };
}

export async function confirmarConciliacionDiaria(input: DailyReconciliationInput) {
  for (const totales of [input.epos, input.confirmado]) {
    if (Object.values(totales).some(n => !Number.isFinite(n) || n < 0) || Math.abs(totales.ventas - totales.efectivo - totales.tarjeta - totales.otros) > .010001) throw new HttpError(400, 'El total del corte debe coincidir con efectivo + tarjeta + otros');
  }
  if (!Number.isInteger(input.cuentasAbiertas) || input.cuentasAbiertas < 0) throw new HttpError(400, 'El número de cuentas abiertas debe ser entero y no negativo');
  if (input.diario && (input.confirmado.otros !== 0 || Math.abs(input.diario.venta_efectivo - input.confirmado.efectivo) > .01 || Math.abs(input.diario.venta_tarjeta - input.confirmado.tarjeta) > .01)) throw new HttpError(400, 'Los importes financieros deben coincidir con el corte confirmado; clasifica los métodos desconocidos primero');
  const fecha = fechaUtc(input.fecha);
  return prisma.$transaction(async tx => {
  await bloquearLibro(tx, input.negocioId);
  const semana = await tx.semanas.findFirst({ where: { id: input.semanaId, negocio_id: input.negocioId } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana está cerrada');
  const inicio = semana.fecha_inicio.getTime();
  const fin = semana.fecha_fin.getTime();
  if (fecha.getTime() < inicio || fecha.getTime() > fin) throw new HttpError(400, 'La fecha está fuera de la semana');

  if (input.diario) await escribirDiaEnTx(tx, input.negocioId, input.usuarioId, input.semanaId, input.fecha, input.diario);
  const row = await tx.conciliaciones_diarias.upsert({
    where: { negocio_id_fecha: { negocio_id: input.negocioId, fecha } },
    create: {
      negocio_id: input.negocioId, semana_id: input.semanaId, fecha, estado: 'confirmada',
      epos_ventas: input.epos.ventas, epos_efectivo: input.epos.efectivo, epos_tarjeta: input.epos.tarjeta, epos_otros: input.epos.otros,
      confirmado_ventas: input.confirmado.ventas, confirmado_efectivo: input.confirmado.efectivo,
      confirmado_tarjeta: input.confirmado.tarjeta, confirmado_otros: input.confirmado.otros,
      cuentas_abiertas: input.cuentasAbiertas, excepciones_json: JSON.stringify(input.excepciones), notas: input.notas,
      usuario_id: input.usuarioId, confirmado_at: new Date(),
    },
    update: {
      semana_id: input.semanaId, estado: 'confirmada',
      epos_ventas: input.epos.ventas, epos_efectivo: input.epos.efectivo, epos_tarjeta: input.epos.tarjeta, epos_otros: input.epos.otros,
      confirmado_ventas: input.confirmado.ventas, confirmado_efectivo: input.confirmado.efectivo,
      confirmado_tarjeta: input.confirmado.tarjeta, confirmado_otros: input.confirmado.otros,
      cuentas_abiertas: input.cuentasAbiertas, excepciones_json: JSON.stringify(input.excepciones), notas: input.notas,
      usuario_id: input.usuarioId, confirmado_at: new Date(),
    },
  });
  return salida(row);
  });
}

export async function listarConciliacionesDiarias(negocioId: bigint, semanaId: bigint) {
  const rows = await prisma.conciliaciones_diarias.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { fecha: 'asc' } });
  return rows.map(salida);
}
