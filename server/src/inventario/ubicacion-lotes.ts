import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

function fechaUTC(fecha?: string) {
  const value = new Date(`${fecha ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new HttpError(400, 'Fecha de transferencia inválida');
  return value;
}

/**
 * Mueve un lote completo entre zonas y deja una bitácora inmutable.
 * El saldo completo es intencional: un lote con saldo parcial no puede
 * representarse con una sola zona sin falsear el inventario. Para dividirlo
 * se debe registrar primero una corrección/lote separado.
 */
export async function transferirLote(input: {
  negocioId: bigint;
  loteId: bigint;
  zonaDestinoId: bigint;
  fecha?: string;
  motivo?: string | null;
  usuarioId?: bigint | null;
}) {
  return prisma.$transaction(async (tx) => {
    const [lote, destino] = await Promise.all([
      tx.inventory_lots.findFirst({ where: { id: input.loteId, negocio_id: input.negocioId }, select: { id: true, zona_id: true, cantidad_restante: true, estado: true, product_id: true } }),
      tx.zonas_inventario.findFirst({ where: { id: input.zonaDestinoId, negocio_id: input.negocioId }, select: { id: true, nombre: true } }),
    ]);
    if (!lote) throw new HttpError(404, 'Lote no encontrado');
    if (!destino) throw new HttpError(404, 'Zona destino no encontrada');
    if (lote.zona_id === destino.id) throw new HttpError(409, 'El lote ya está en esa zona');
    const cantidad = Number(lote.cantidad_restante);
    if (lote.estado !== 'abierto' || cantidad <= 0) throw new HttpError(409, 'Sólo se pueden transferir lotes abiertos con saldo');

    const actualizado = await tx.inventory_lots.update({ where: { id: lote.id }, data: { zona_id: destino.id } });
    const movimiento = await tx.inventory_lot_transfers.create({
      data: {
        negocio_id: input.negocioId,
        lote_id: lote.id,
        zona_origen_id: lote.zona_id,
        zona_destino_id: destino.id,
        cantidad,
        fecha: fechaUTC(input.fecha),
        motivo: input.motivo?.trim() || null,
        usuario_id: input.usuarioId ?? null,
      },
    });
    return {
      id: Number(movimiento.id),
      lote_id: Number(actualizado.id),
      product_id: Number(actualizado.product_id),
      zona_destino_id: Number(destino.id),
      zona_destino: destino.nombre,
      cantidad,
      fecha: movimiento.fecha.toISOString().slice(0, 10),
    };
  }, { timeout: 15000 });
}

export async function listarTransferencias(negocioId: bigint, loteId?: bigint) {
  const rows = await prisma.inventory_lot_transfers.findMany({
    where: { negocio_id: negocioId, ...(loteId ? { lote_id: loteId } : {}) },
    include: {
      zona_origen: { select: { nombre: true } },
      zona_destino: { select: { nombre: true } },
      lote: { include: { products: { select: { name: true } } } },
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
  });
  return rows.map((row) => ({
    id: Number(row.id), lote_id: Number(row.lote_id), product_id: Number(row.lote.product_id), producto: row.lote.products.name,
    zona_origen_id: row.zona_origen_id == null ? null : Number(row.zona_origen_id), zona_origen: row.zona_origen?.nombre ?? null,
    zona_destino_id: Number(row.zona_destino_id), zona_destino: row.zona_destino.nombre,
    cantidad: Number(row.cantidad), fecha: row.fecha.toISOString().slice(0, 10), motivo: row.motivo,
  }));
}
