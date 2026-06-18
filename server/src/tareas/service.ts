import type { TipoChecklist } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
//  Gestión de checklists (admin)
// ---------------------------------------------------------------------------
export async function listarChecklists(negocioId: bigint) {
  const cls = await prisma.checklists.findMany({
    where: { negocio_id: negocioId },
    include: { items: { orderBy: { orden: 'asc' } } },
    orderBy: [{ tipo: 'asc' }, { id: 'asc' }],
  });
  return cls.map((c) => ({
    id: Number(c.id),
    nombre: c.nombre,
    tipo: c.tipo,
    activo: c.activo,
    items: c.items.map((i) => ({ id: Number(i.id), texto: i.texto, orden: i.orden })),
  }));
}

export async function crearChecklist(negocioId: bigint, b: { nombre: string; tipo: TipoChecklist }) {
  const c = await prisma.checklists.create({ data: { negocio_id: negocioId, nombre: b.nombre, tipo: b.tipo } });
  return { id: Number(c.id) };
}

export async function actualizarChecklist(negocioId: bigint, id: bigint, b: { nombre?: string; activo?: boolean }) {
  const c = await prisma.checklists.findFirst({ where: { id, negocio_id: negocioId } });
  if (!c) throw new HttpError(404, 'Checklist no encontrado');
  await prisma.checklists.update({ where: { id }, data: { nombre: b.nombre, activo: b.activo } });
  return { ok: true };
}

async function checklistDelNegocio(negocioId: bigint, checklistId: bigint) {
  const c = await prisma.checklists.findFirst({ where: { id: checklistId, negocio_id: negocioId } });
  if (!c) throw new HttpError(404, 'Checklist no encontrado');
  return c;
}

export async function agregarItem(negocioId: bigint, checklistId: bigint, b: { texto: string; orden?: number }) {
  await checklistDelNegocio(negocioId, checklistId);
  const item = await prisma.checklist_items.create({
    data: { checklist_id: checklistId, texto: b.texto, orden: b.orden ?? 0 },
  });
  return { id: Number(item.id) };
}

async function itemDelNegocio(negocioId: bigint, itemId: bigint) {
  const item = await prisma.checklist_items.findUnique({ where: { id: itemId }, include: { checklists: true } });
  if (!item || item.checklists.negocio_id !== negocioId) throw new HttpError(404, 'Ítem no encontrado');
  return item;
}

export async function actualizarItem(negocioId: bigint, itemId: bigint, b: { texto?: string; orden?: number }) {
  await itemDelNegocio(negocioId, itemId);
  await prisma.checklist_items.update({ where: { id: itemId }, data: { texto: b.texto, orden: b.orden } });
  return { ok: true };
}

export async function eliminarItem(negocioId: bigint, itemId: bigint) {
  await itemDelNegocio(negocioId, itemId);
  await prisma.checklist_items.delete({ where: { id: itemId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  Día de tareas (admin + empleado)
// ---------------------------------------------------------------------------

/** Para una fecha, devuelve cada checklist activo con su instancia y el estado de cada ítem. */
export async function diaDeTareas(negocioId: bigint, fechaStr: string) {
  const fecha = new Date(fechaStr + 'T00:00:00Z');
  const checklists = await prisma.checklists.findMany({
    where: { negocio_id: negocioId, activo: true },
    include: { items: { orderBy: { orden: 'asc' } } },
    orderBy: [{ tipo: 'asc' }, { id: 'asc' }],
  });

  const resultado = [];
  for (const c of checklists) {
    // Asegura la instancia del día (idempotente por unique [checklist_id, fecha]).
    const instancia = await prisma.checklist_instancias.upsert({
      where: { checklist_id_fecha: { checklist_id: c.id, fecha } },
      update: {},
      create: { checklist_id: c.id, fecha },
    });
    const resultados = await prisma.checklist_item_resultados.findMany({ where: { instancia_id: instancia.id } });
    const doneMap = new Map(resultados.map((r) => [r.item_id.toString(), r.completado]));

    const items = c.items.map((i) => ({
      id: Number(i.id),
      texto: i.texto,
      orden: i.orden,
      completado: doneMap.get(i.id.toString()) ?? false,
    }));
    const hechos = items.filter((i) => i.completado).length;
    resultado.push({
      checklist_id: Number(c.id),
      instancia_id: Number(instancia.id),
      nombre: c.nombre,
      tipo: c.tipo,
      items,
      progreso: { hechos, total: items.length },
    });
  }
  return { fecha: iso(fecha), checklists: resultado };
}

/** Marca/desmarca un ítem en una instancia. */
export async function marcarResultado(negocioId: bigint, usuarioId: bigint, instanciaId: bigint, itemId: bigint, completado: boolean) {
  const instancia = await prisma.checklist_instancias.findUnique({
    where: { id: instanciaId },
    include: { checklists: true },
  });
  if (!instancia || instancia.checklists.negocio_id !== negocioId) throw new HttpError(404, 'Instancia no encontrada');
  // El ítem debe pertenecer al mismo checklist de la instancia.
  const item = await prisma.checklist_items.findFirst({ where: { id: itemId, checklist_id: instancia.checklist_id } });
  if (!item) throw new HttpError(400, 'El ítem no pertenece a este checklist');

  await prisma.checklist_item_resultados.upsert({
    where: { instancia_id_item_id: { instancia_id: instanciaId, item_id: itemId } },
    update: { completado, usuario_id: usuarioId, completado_at: completado ? new Date() : null },
    create: { instancia_id: instanciaId, item_id: itemId, completado, usuario_id: usuarioId, completado_at: completado ? new Date() : null },
  });
  return { ok: true };
}
