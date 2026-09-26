import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

type DbClient = PrismaClient | Prisma.TransactionClient;
export type EstadoFactura = 'no_facturado' | 'facturado';

export function mesDeFecha(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
}

function mesISO(fecha: Date) {
  return fecha.toISOString().slice(0, 7);
}

function validarComprobante(data?: string | null, mime?: string | null, nombre?: string | null) {
  if (!data) return null;
  if (!mime || !/^(application\/pdf|image\/(jpeg|png|webp|heic))$/i.test(mime)) {
    throw new HttpError(400, 'El comprobante debe ser PDF, JPG, PNG, WEBP o HEIC');
  }
  const limpia = data.replace(/^data:[^;]+;base64,/, '');
  if (limpia.length > 8_000_000) throw new HttpError(413, 'El comprobante es demasiado grande; usa un archivo menor a 6 MB');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(limpia)) throw new HttpError(400, 'El comprobante no tiene un formato base64 válido');
  const limpiaSinEspacios = limpia.replace(/\s/g, '');
  return {
    data: limpiaSinEspacios,
    mime,
    nombre: nombre?.trim().slice(0, 180) || null,
    hash: crypto.createHash('sha256').update(limpiaSinEspacios).digest('hex'),
  };
}

/** Crea las filas faltantes para compras confirmadas pagadas desde Banco.
 * Es idempotente y también sirve para incorporar compras históricas al nuevo
 * archivo sin modificar sus movimientos ni su FIFO. */
export async function asegurarFacturasBanco(negocioId: bigint, client: DbClient = prisma) {
  const compras = await client.purchases.findMany({
    where: { negocio_id: negocioId, estado: 'confirmada', origen_pago: { tipo: 'banco' } },
    select: { id: true, fecha_recepcion: true },
  });
  if (compras.length) {
    await client.facturas.createMany({
      data: compras.map((compra) => ({ negocio_id: negocioId, compra_id: compra.id, mes: mesDeFecha(compra.fecha_recepcion) })),
      skipDuplicates: true,
    });
  }
}

export async function listarFacturas(negocioId: bigint) {
  await asegurarFacturasBanco(negocioId);
  const filas = await prisma.facturas.findMany({
    where: { negocio_id: negocioId, purchases: { estado: 'confirmada', origen_pago: { tipo: 'banco' } } },
    include: {
      purchases: { select: { id: true, fecha_recepcion: true, proveedor: true, ticket_ref: true, total: true, moneda: true, origen_pago: { select: { nombre: true } } } },
    },
    orderBy: [{ mes: 'desc' }, { purchases: { fecha_recepcion: 'desc' } }, { id: 'desc' }],
  });
  const meses = new Map<string, {
    mes: string;
    compras: number;
    facturadas: number;
    no_facturadas: number;
    total: number;
    facturas: ReturnType<typeof mapFactura>[];
  }>();
  for (const fila of filas) {
    const item = mapFactura(fila);
    const key = mesISO(fila.mes);
    const grupo = meses.get(key) ?? { mes: key, compras: 0, facturadas: 0, no_facturadas: 0, total: 0, facturas: [] };
    grupo.compras += 1;
    grupo.total += item.total;
    if (item.estado === 'facturado') grupo.facturadas += 1;
    else grupo.no_facturadas += 1;
    grupo.facturas.push(item);
    meses.set(key, grupo);
  }
  return {
    meses: [...meses.values()].map((grupo) => ({ ...grupo, total: redondear(grupo.total) })),
    total_compras: filas.length,
    total_facturadas: filas.filter((f) => f.estado === 'facturado').length,
    total_no_facturadas: filas.filter((f) => f.estado !== 'facturado').length,
  };
}

function mapFactura(fila: {
  id: bigint; compra_id: bigint; mes: Date; estado: string; comprobante_data: string | null;
  comprobante_mime: string | null; comprobante_nombre: string | null; notas: string | null;
  purchases: { id: bigint; fecha_recepcion: Date; proveedor: string | null; ticket_ref: string | null; total: Prisma.Decimal | null; moneda: string; origen_pago: { nombre: string } | null };
}) {
  return {
    id: Number(fila.id),
    compra_id: Number(fila.compra_id),
    mes: mesISO(fila.mes),
    fecha: fila.purchases.fecha_recepcion.toISOString().slice(0, 10),
    proveedor: fila.purchases.proveedor,
    ticket_ref: fila.purchases.ticket_ref,
    total: Number(fila.purchases.total ?? 0),
    moneda: fila.purchases.moneda,
    origen_pago: fila.purchases.origen_pago?.nombre ?? 'Banco',
    estado: fila.estado === 'facturado' ? 'facturado' as const : 'no_facturado' as const,
    comprobante: Boolean(fila.comprobante_data),
    comprobante_mime: fila.comprobante_mime,
    comprobante_nombre: fila.comprobante_nombre,
    notas: fila.notas,
  };
}

export async function actualizarFactura(negocioId: bigint, facturaId: bigint, input: {
  estado?: EstadoFactura;
  comprobante_data?: string | null;
  comprobante_mime?: string | null;
  comprobante_nombre?: string | null;
  notas?: string | null;
}) {
  const actual = await prisma.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId }, select: { id: true } });
  if (!actual) throw new HttpError(404, 'Factura no encontrada');
  const comprobante = input.comprobante_data == null ? null : validarComprobante(input.comprobante_data, input.comprobante_mime, input.comprobante_nombre);
  const actualizado = await prisma.facturas.update({
    where: { id: actual.id },
    data: {
      ...(input.estado ? { estado: input.estado } : {}),
      ...(comprobante ? { comprobante_data: comprobante.data, comprobante_mime: comprobante.mime, comprobante_nombre: comprobante.nombre, comprobante_hash: comprobante.hash } : {}),
      ...(input.notas !== undefined ? { notas: input.notas?.trim() || null } : {}),
    },
    include: { purchases: { select: { id: true, fecha_recepcion: true, proveedor: true, ticket_ref: true, total: true, moneda: true, origen_pago: { select: { nombre: true } } } } },
  });
  return mapFactura(actualizado);
}

export async function obtenerComprobanteFactura(negocioId: bigint, facturaId: bigint) {
  const factura = await prisma.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId }, select: { comprobante_data: true, comprobante_mime: true, comprobante_nombre: true } });
  if (!factura?.comprobante_data || !factura.comprobante_mime) throw new HttpError(404, 'Esta factura no tiene comprobante adjunto');
  return { data: factura.comprobante_data, mime: factura.comprobante_mime, nombre: factura.comprobante_nombre };
}

function redondear(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
