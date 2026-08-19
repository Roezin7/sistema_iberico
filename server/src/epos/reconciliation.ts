import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { num0 } from '../lib/num.js';

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
}

function fechaUtc(fecha: string) {
  const value = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new HttpError(400, 'Fecha inválida');
  return value;
}

function salida(row: {
  id: bigint; negocio_id: bigint; semana_id: bigint; fecha: Date; estado: string;
  epos_ventas: unknown; epos_efectivo: unknown; epos_tarjeta: unknown; epos_otros: unknown;
  confirmado_ventas: unknown; confirmado_efectivo: unknown; confirmado_tarjeta: unknown; confirmado_otros: unknown;
  cuentas_abiertas: unknown; excepciones_json: string | null; notas: string | null; usuario_id: bigint | null; confirmado_at: Date | null;
}) {
  return {
    id: Number(row.id), negocio_id: Number(row.negocio_id), semana_id: Number(row.semana_id),
    fecha: row.fecha.toISOString().slice(0, 10), estado: row.estado,
    epos: { ventas: num0(row.epos_ventas as never), efectivo: num0(row.epos_efectivo as never), tarjeta: num0(row.epos_tarjeta as never), otros: num0(row.epos_otros as never) },
    confirmado: { ventas: num0(row.confirmado_ventas as never), efectivo: num0(row.confirmado_efectivo as never), tarjeta: num0(row.confirmado_tarjeta as never), otros: num0(row.confirmado_otros as never) },
    cuentas_abiertas: num0(row.cuentas_abiertas as never),
    excepciones: row.excepciones_json ? JSON.parse(row.excepciones_json) : [],
    notas: row.notas,
    usuario_id: row.usuario_id ? Number(row.usuario_id) : null,
    confirmado_at: row.confirmado_at?.toISOString() ?? null,
  };
}

export async function confirmarConciliacionDiaria(input: DailyReconciliationInput) {
  const fecha = fechaUtc(input.fecha);
  const semana = await prisma.semanas.findFirst({ where: { id: input.semanaId, negocio_id: input.negocioId } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana está cerrada');
  const inicio = semana.fecha_inicio.getTime();
  const fin = semana.fecha_fin.getTime();
  if (fecha.getTime() < inicio || fecha.getTime() > fin) throw new HttpError(400, 'La fecha está fuera de la semana');

  const row = await prisma.conciliaciones_diarias.upsert({
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
}

export async function listarConciliacionesDiarias(negocioId: bigint, semanaId: bigint) {
  const rows = await prisma.conciliaciones_diarias.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { fecha: 'asc' } });
  return rows.map(salida);
}
