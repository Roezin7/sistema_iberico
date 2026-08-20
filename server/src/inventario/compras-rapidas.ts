import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { notasDeValidacion, resumirCompra, validarDiscrepanciasCompra, type ProductoReglaCompra } from './compras-rapidas-logic.js';

export type CapturaCompraLinea = {
  product_id?: bigint | null;
  tipo_linea: 'inventario' | 'gasto' | 'pendiente';
  descripcion_fuente: string;
  cantidad_base?: number | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  costo_unitario?: number | null;
  importe: number;
  confianza?: number | null;
  notas?: string | null;
};

export type CapturaCompraInput = {
  fecha_recepcion: string;
  proveedor?: string | null;
  ticket_ref?: string | null;
  total: number;
  moneda?: string;
  notas?: string | null;
  origen_pago_id?: bigint | null;
  foto_data?: string | null;
  foto_mime?: string | null;
  lineas: CapturaCompraLinea[];
};

function fechaUTC(fecha: string): Date {
  const value = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new HttpError(400, 'Fecha de compra inválida');
  return value;
}

function validarFoto(data?: string | null, mime?: string | null) {
  if (!data) return null;
  if (!mime || !/^image\/(jpeg|png|webp|heic)$/i.test(mime)) throw new HttpError(400, 'Formato de foto no soportado');
  if (data.length > 8_000_000) throw new HttpError(413, 'La foto es demasiado grande; usa una imagen de menos de 6 MB');
  const limpia = data.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(limpia)) throw new HttpError(400, 'La foto no tiene un formato base64 válido');
  return { data: limpia.replace(/\s/g, ''), mime, hash: crypto.createHash('sha256').update(limpia).digest('hex') };
}

async function validarOrigen(negocioId: bigint, origenPagoId?: bigint | null) {
  if (!origenPagoId) return null;
  const origen = await prisma.ubicaciones_fondos.findFirst({ where: { id: origenPagoId, negocio_id: negocioId, activo: true } });
  if (!origen) throw new HttpError(400, 'La ubicación de pago no pertenece al negocio');
  return origen;
}

export async function crearBorradorCompra(negocioId: bigint, usuarioId: bigint, input: CapturaCompraInput) {
  if (!input.lineas.length) throw new HttpError(400, 'El ticket debe tener al menos una línea');
  if (input.total < 0 || input.lineas.some((l) => !l.descripcion_fuente.trim() || l.importe < 0)) {
    throw new HttpError(400, 'El total y las líneas deben tener valores válidos');
  }
  const fecha = fechaUTC(input.fecha_recepcion);
  const ticket = input.ticket_ref?.trim() || null;
  const foto = validarFoto(input.foto_data, input.foto_mime);
  await validarOrigen(negocioId, input.origen_pago_id);

  return prisma.$transaction(async (tx) => {
    if (ticket || foto?.hash) {
      const repetida = await tx.purchases.findFirst({
        where: { negocio_id: negocioId, ...(ticket ? { ticket_ref: ticket } : { foto_hash: foto!.hash, fecha_recepcion: fecha }) },
        select: { id: true, estado: true },
      });
      if (repetida) throw new HttpError(409, `El ticket${ticket ? ` ${ticket}` : ''} ya existe (${repetida.estado})`);
    }
    const compra = await tx.purchases.create({
      data: {
        negocio_id: negocioId, fecha_recepcion: fecha, proveedor: input.proveedor?.trim() || null,
        ticket_ref: ticket, total: input.total, moneda: input.moneda ?? 'MXN', fuente: 'ticket_movil',
        notas: input.notas?.trim() || null, estado: 'revision', foto_data: foto?.data ?? null,
        foto_mime: foto?.mime ?? null, foto_hash: foto?.hash ?? null, origen_pago_id: input.origen_pago_id ?? null,
        capturada_por: usuarioId,
      },
    });
    await tx.purchase_capture_lines.createMany({
      data: input.lineas.map((l) => ({
        purchase_id: compra.id, product_id: l.product_id ?? null, tipo_linea: l.tipo_linea,
        descripcion_fuente: l.descripcion_fuente.trim(), cantidad_base: l.cantidad_base ?? null,
        unidad_compra: l.unidad_compra?.trim() || null, contenido_compra: l.contenido_compra ?? null,
        costo_unitario: l.costo_unitario ?? null, importe: l.importe, confianza: l.confianza ?? null,
        notas: l.notas?.trim() || null,
      })),
    });
    return { purchase_id: Number(compra.id), estado: compra.estado, lineas: input.lineas.length };
  });
}

export async function listarBorradoresCompra(negocioId: bigint) {
  const filas = await prisma.purchases.findMany({
    where: { negocio_id: negocioId, estado: { in: ['revision', 'borrador'] } },
    include: { capture_lines: { include: { products: { select: { name: true, unidad_base: true } } } } },
    orderBy: [{ fecha_recepcion: 'desc' }, { id: 'desc' }],
  });
  return filas.map((f) => ({
    id: Number(f.id), fecha_recepcion: f.fecha_recepcion.toISOString().slice(0, 10), proveedor: f.proveedor,
    ticket_ref: f.ticket_ref, total: Number(f.total ?? 0), estado: f.estado, foto: !!f.foto_data, notas: f.notas,
    origen_pago_id: f.origen_pago_id ? Number(f.origen_pago_id) : null,
    lineas: f.capture_lines.map((l) => ({ id: Number(l.id), product_id: l.product_id ? Number(l.product_id) : null,
      producto: l.products?.name ?? null, tipo_linea: l.tipo_linea, descripcion_fuente: l.descripcion_fuente,
      cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base), unidad_compra: l.unidad_compra,
      contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra), costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario), importe: Number(l.importe), confianza: l.confianza == null ? null : Number(l.confianza), notas: l.notas })),
  }));
}

export async function referenciasCompra(negocioId: bigint) {
  const [productos, ubicaciones] = await Promise.all([
    prisma.products.findMany({ where: { negocio_id: negocioId, active: true }, select: { id: true, name: true, unidad_base: true }, orderBy: { name: 'asc' } }),
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true }, select: { id: true, nombre: true, tipo: true }, orderBy: { id: 'asc' } }),
  ]);
  return {
    productos: productos.map((p) => ({ id: Number(p.id), nombre: p.name, unidad_base: p.unidad_base })),
    ubicaciones: ubicaciones.map((u) => ({ id: Number(u.id), nombre: u.nombre, tipo: u.tipo })),
  };
}

export async function listarCompras(negocioId: bigint, fecha?: string) {
  const where: { negocio_id: bigint; fecha_recepcion?: Date } = { negocio_id: negocioId };
  if (fecha) where.fecha_recepcion = fechaUTC(fecha);
  const filas = await prisma.purchases.findMany({ where, include: { purchase_lines: { include: { products: { select: { name: true, unidad_base: true } } } }, capture_lines: true, movimientos: { select: { tipo: true, monto: true } } }, orderBy: [{ fecha_recepcion: 'desc' }, { id: 'desc' }] });
  return filas.map((f) => ({ id: Number(f.id), fecha: f.fecha_recepcion.toISOString().slice(0, 10), proveedor: f.proveedor, ticket_ref: f.ticket_ref, total: Number(f.total ?? 0), estado: f.estado, origen_pago_id: f.origen_pago_id ? Number(f.origen_pago_id) : null, movimientos: f.movimientos.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) })), lineas: [...f.purchase_lines.map((l) => ({ tipo: 'inventario', producto: l.products.name, importe: Number(l.importe ?? 0) })), ...f.capture_lines.filter((l) => l.tipo_linea === 'gasto').map((l) => ({ tipo: 'gasto', producto: l.descripcion_fuente, importe: Number(l.importe) }))] }));
}

export async function obtenerFotoCompra(negocioId: bigint, purchaseId: bigint) {
  const compra = await prisma.purchases.findFirst({ where: { id: purchaseId, negocio_id: negocioId }, select: { foto_data: true, foto_mime: true } });
  if (!compra?.foto_data || !compra.foto_mime) throw new HttpError(404, 'Esta compra no tiene fotografía');
  return { mime: compra.foto_mime, data: compra.foto_data };
}

export async function confirmarBorradorCompra(negocioId: bigint, usuarioId: bigint, purchaseId: bigint) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.purchases.updateMany({
      where: { id: purchaseId, negocio_id: negocioId, estado: { in: ['revision', 'borrador'] } },
      data: { estado: 'confirmando' },
    });
    if (claim.count !== 1) {
      const actual = await tx.purchases.findFirst({ where: { id: purchaseId, negocio_id: negocioId }, select: { estado: true } });
      if (!actual) throw new HttpError(404, 'Compra no encontrada');
      throw new HttpError(409, `La compra ya está ${actual.estado}`);
    }
    const compra = await tx.purchases.findFirst({ where: { id: purchaseId, negocio_id: negocioId, estado: 'confirmando' }, include: { capture_lines: true } });
    if (!compra) throw new HttpError(409, 'No se pudo reservar la compra para confirmación');
    if (!compra.origen_pago_id) throw new HttpError(400, 'Selecciona de dónde salió el pago antes de confirmar');
    if (compra.capture_lines.some((l) => l.tipo_linea === 'pendiente' || (l.tipo_linea === 'inventario' && (!l.product_id || !l.cantidad_base || Number(l.cantidad_base) <= 0)))) {
      throw new HttpError(400, 'Todas las líneas deben clasificarse y las de inventario deben tener producto y cantidad');
    }
    const origen = await tx.ubicaciones_fondos.findFirst({ where: { id: compra.origen_pago_id, negocio_id: negocioId, activo: true } });
    if (!origen) throw new HttpError(400, 'La ubicación de pago no es válida');
    const semana = await tx.semanas.findFirst({ where: { negocio_id: negocioId, fecha_inicio: { lte: compra.fecha_recepcion }, fecha_fin: { gte: compra.fecha_recepcion } } });
    if (!semana) throw new HttpError(409, 'No existe una semana abierta para la fecha del ticket');
    if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana del ticket está cerrada');

    const total = Number(compra.total ?? 0);
    const inventory = compra.capture_lines.filter((l) => l.tipo_linea === 'inventario');
    const gastos = compra.capture_lines.filter((l) => l.tipo_linea === 'gasto');
    const resumen = resumirCompra(total, compra.capture_lines.map((l) => ({ tipo_linea: l.tipo_linea as 'inventario' | 'gasto' | 'pendiente', importe: Number(l.importe) })));
    if (!resumen.cuadra) throw new HttpError(400, 'Las líneas deben cuadrar exactamente con el total del ticket; agrega la diferencia como gasto o inventario');
    const inventarioTotal = resumen.inventario;
    const gastoTotal = resumen.gasto;

    const productIds = [...new Set(inventory.map((l) => l.product_id!.toString()))].map(BigInt);
    const productosValidos = productIds.length ? await tx.products.findMany({
      where: { negocio_id: negocioId, id: { in: productIds }, active: true },
      select: { id: true, name: true, unidad_base: true, contenido_compra: true, unidad_compra: true, product_aliases: { select: { alias: true } } },
    }) : [];
    const validos = new Set(productosValidos.map((p) => p.id.toString()));
    const faltantes = productIds.filter((id) => !validos.has(id.toString()));
    if (faltantes.length) throw new HttpError(400, `Producto de inventario no válido para este negocio: ${faltantes.map(String).join(', ')}`);

    const reglasProductos: ProductoReglaCompra[] = productosValidos.map((p) => ({
      id: p.id,
      name: p.name,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      unidad_compra: p.unidad_compra,
      aliases: p.product_aliases.map((a) => a.alias),
    }));
    const validacion = validarDiscrepanciasCompra(total, compra.capture_lines.map((l) => ({
      tipo_linea: l.tipo_linea as 'inventario' | 'gasto' | 'pendiente',
      importe: Number(l.importe),
      product_id: l.product_id,
      descripcion_fuente: l.descripcion_fuente,
      cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base),
      unidad_compra: l.unidad_compra,
      contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra),
      costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario),
    })), reglasProductos);
    if (validacion.errores.length) {
      throw new HttpError(400, `La compra tiene discrepancias que deben corregirse: ${validacion.errores.map((d) => `[${d.codigo}] ${d.mensaje}`).join(' ')}`);
    }
    const notasCompra = notasDeValidacion(compra.notas, validacion);

    const productos = new Map<string, { qty: number; importe: number; costo: number; unidad: string | null; contenido: number | null }>();
    for (const l of inventory) {
      const key = l.product_id!.toString();
      const prev = productos.get(key);
      const qty = Number(l.cantidad_base);
      const importe = Number(l.importe);
      const costo = l.costo_unitario == null ? importe / qty : Number(l.costo_unitario);
      productos.set(key, prev ? { qty: prev.qty + qty, importe: prev.importe + importe, costo: (prev.importe + importe) / (prev.qty + qty), unidad: prev.unidad ?? l.unidad_compra, contenido: prev.contenido ?? (l.contenido_compra == null ? null : Number(l.contenido_compra)) } : { qty, importe, costo, unidad: l.unidad_compra, contenido: l.contenido_compra == null ? null : Number(l.contenido_compra) });
    }
    for (const [productId, line] of productos) {
      const costo = line.costo;
      const purchaseLine = await tx.purchase_lines.create({ data: { purchase_id: compra.id, product_id: BigInt(productId), qty: line.qty, unidad_compra: line.unidad, contenido_compra: line.contenido, costo_unitario: costo, importe: line.importe } });
      await tx.inventory_lots.create({ data: { negocio_id: negocioId, product_id: purchaseLine.product_id, purchase_id: compra.id, recibido_at: compra.fecha_recepcion, cantidad_inicial: line.qty, cantidad_restante: line.qty, costo_unitario: costo, moneda: compra.moneda, fuente: 'ticket_movil', ticket_ref: compra.ticket_ref, notas: notasCompra } });
    }
    const categoria = gastoTotal > 0 ? await tx.categorias_gasto.findFirst({ where: { negocio_id: negocioId, nombre: 'Otros', activo: true } }) : null;
    const facturado = origen.tipo === 'banco';
    if (inventarioTotal > 0) {
      await tx.movimientos.create({ data: { negocio_id: negocioId, semana_id: semana.id, fecha: compra.fecha_recepcion, tipo: 'compra_inventario', monto: inventarioTotal, ubicacion_origen_id: origen.id, facturado, descripcion: `Compra ticket ${compra.ticket_ref ?? compra.id}`, usuario_id: usuarioId, compra_id: compra.id } });
    }
    if (gastoTotal > 0) {
      await tx.movimientos.create({ data: { negocio_id: negocioId, semana_id: semana.id, fecha: compra.fecha_recepcion, tipo: 'gasto', monto: gastoTotal, ubicacion_origen_id: origen.id, categoria_id: categoria?.id ?? null, facturado, descripcion: `Compra ticket ${compra.ticket_ref ?? compra.id}${gastos.length ? ' · gasto operativo' : ' · diferencia no itemizada'}`, usuario_id: usuarioId, compra_id: compra.id } });
    }
    await tx.purchases.update({ where: { id: compra.id }, data: { estado: 'confirmada', notas: notasCompra, confirmada_por: usuarioId, confirmada_at: new Date() } });
    return { purchase_id: Number(compra.id), estado: 'confirmada', inventario: inventarioTotal, gasto: gastoTotal, movimientos: (inventarioTotal > 0 ? 1 : 0) + (gastoTotal > 0 ? 1 : 0), discrepancias: validacion.advertencias };
  });
}

export async function actualizarBorradorLineas(negocioId: bigint, purchaseId: bigint, lineas: CapturaCompraLinea[]) {
  const compra = await prisma.purchases.findFirst({ where: { id: purchaseId, negocio_id: negocioId, estado: { in: ['revision', 'borrador'] } }, select: { id: true } });
  if (!compra) throw new HttpError(404, 'Compra pendiente no encontrada');
  if (!lineas.length) throw new HttpError(400, 'La compra debe conservar al menos una línea');
  await prisma.$transaction(async (tx) => {
    await tx.purchase_capture_lines.deleteMany({ where: { purchase_id: purchaseId } });
    await tx.purchase_capture_lines.createMany({ data: lineas.map((l) => ({ purchase_id: purchaseId, product_id: l.product_id ?? null, tipo_linea: l.tipo_linea, descripcion_fuente: l.descripcion_fuente.trim(), cantidad_base: l.cantidad_base ?? null, unidad_compra: l.unidad_compra?.trim() || null, contenido_compra: l.contenido_compra ?? null, costo_unitario: l.costo_unitario ?? null, importe: l.importe, confianza: l.confianza ?? null, notas: l.notas?.trim() || null })) });
  });
  return { purchase_id: Number(purchaseId), actualizado: true, lineas: lineas.length };
}

export async function rechazarBorradorCompra(negocioId: bigint, purchaseId: bigint, nota?: string) {
  const compra = await prisma.purchases.findFirst({ where: { id: purchaseId, negocio_id: negocioId } });
  if (!compra) throw new HttpError(404, 'Compra no encontrada');
  if (!['revision', 'borrador'].includes(compra.estado)) throw new HttpError(409, `La compra ya está ${compra.estado}`);
  return prisma.purchases.update({ where: { id: purchaseId }, data: { estado: 'rechazada', notas: nota?.trim() || compra.notas } });
}
