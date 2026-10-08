import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';

type Cliente = typeof prisma | Prisma.TransactionClient;

/** Registra cambios como evidencia adicional de las operaciones de dominio. */
export async function registrarAuditoria(input: {
  negocioId: bigint;
  usuarioId?: bigint | null;
  entidad: string;
  entidadId?: string | number | bigint | null;
  accion: string;
  antes?: unknown;
  despues?: unknown;
  metadata?: unknown;
}, cliente: Cliente = prisma) {
  try {
    await cliente.auditoria_eventos.create({
      data: {
        negocio_id: input.negocioId,
        usuario_id: input.usuarioId ?? null,
        entidad: input.entidad,
        entidad_id: input.entidadId == null ? null : String(input.entidadId),
        accion: input.accion,
        antes: input.antes == null ? null : JSON.stringify(input.antes),
        despues: input.despues == null ? null : JSON.stringify(input.despues),
        metadata: input.metadata == null ? null : JSON.stringify(input.metadata),
      },
    });
  } catch {
    // La operación principal no debe revertirse si la tabla de auditoría está
    // pendiente de migración en un despliegue rolling.
  }
}

export async function listarAuditoria(negocioId: bigint, opciones: { entidad?: string; limite?: number } = {}) {
  const filas = await prisma.auditoria_eventos.findMany({
    where: { negocio_id: negocioId, ...(opciones.entidad ? { entidad: opciones.entidad } : {}) },
    orderBy: [{ creado_at: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(opciones.limite ?? 100, 1), 500),
    include: { usuarios: { select: { nombre: true } } },
  });
  return filas.map((fila) => ({
    id: Number(fila.id), entidad: fila.entidad, entidad_id: fila.entidad_id,
    accion: fila.accion, antes: fila.antes ? JSON.parse(fila.antes) : null,
    despues: fila.despues ? JSON.parse(fila.despues) : null,
    metadata: fila.metadata ? JSON.parse(fila.metadata) : null,
    usuario: fila.usuarios?.nombre ?? null, creado_at: fila.creado_at.toISOString(),
  }));
}
