import { prisma } from '../db.js';
import { conversar } from './agent.js';

export async function chat(negocioId: bigint, mensaje: string) {
  await prisma.silvia_mensajes.create({ data: { negocio_id: negocioId, rol: 'user', contenido: mensaje } });
  const r = await conversar(negocioId, mensaje);
  await prisma.silvia_mensajes.create({ data: { negocio_id: negocioId, rol: 'assistant', contenido: r.texto } });
  return r;
}

export async function historial(negocioId: bigint) {
  const msgs = await prisma.silvia_mensajes.findMany({
    where: { negocio_id: negocioId },
    orderBy: { id: 'asc' },
    take: 100,
  });
  return msgs.map((m) => ({ id: Number(m.id), rol: m.rol, contenido: m.contenido, creado_at: m.creado_at.toISOString() }));
}

export async function listarMemoria(negocioId: bigint) {
  const mem = await prisma.silvia_memoria.findMany({ where: { negocio_id: negocioId }, orderBy: { id: 'desc' } });
  return mem.map((m) => ({
    id: Number(m.id),
    tipo: m.tipo,
    contenido: m.contenido,
    fecha: m.fecha ? m.fecha.toISOString().slice(0, 10) : null,
  }));
}

export async function registrarEvento(negocioId: bigint, contenido: string, fecha?: string) {
  const e = await prisma.silvia_memoria.create({
    data: { negocio_id: negocioId, tipo: 'evento', contenido, fecha: fecha ? new Date(fecha + 'T00:00:00Z') : null },
  });
  return { id: Number(e.id) };
}

export async function borrarMemoria(negocioId: bigint, id: bigint) {
  const m = await prisma.silvia_memoria.findFirst({ where: { id, negocio_id: negocioId } });
  if (m) await prisma.silvia_memoria.delete({ where: { id } });
  return { ok: true };
}
