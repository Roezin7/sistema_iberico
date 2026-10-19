import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { costearVentasPendientesEnVivo } from './consumo-epos.js';
import { asegurarFacturasBanco } from '../facturacion/service.js';
import { registrarAuditoria } from '../lib/auditoria.js';

export interface LineaCompraInput {
  product_id: bigint;
  cantidad_base: number;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  costo_unitario_base: number;
  importe?: number | null;
}

export interface CompraInput {
  fecha_recepcion: string;
  proveedor?: string | null;
  ticket_ref?: string | null;
  total?: number | null;
  moneda?: string;
  fuente?: string;
  notas?: string | null;
  origen_pago_id: bigint;
  usuario_id: bigint;
  lineas: LineaCompraInput[];
}

function fechaUTC(fecha: string): Date {
  const value = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new HttpError(400, 'fecha_recepcion inválida');
  return value;
}

/**
 * Registra una compra ya revisada y crea un lote FIFO por cada línea.
 * La cantidad del lote siempre está en unidad base (g, ml o pieza), nunca en
 * la presentación comercial; así el consumo de recetas no mezcla unidades.
 */
export async function registrarCompra(negocioId: bigint, input: CompraInput) {
  if (!input.lineas.length) throw new HttpError(400, 'La compra debe tener al menos una línea');
  if (input.lineas.some((l) => l.cantidad_base <= 0 || l.costo_unitario_base < 0)) {
    throw new HttpError(400, 'Cada línea debe tener cantidad base positiva y costo válido');
  }

  const fecha = fechaUTC(input.fecha_recepcion);
  const ticketRef = input.ticket_ref?.trim() || null;
  const resultado = await prisma.$transaction(async (tx) => {
    const semana = await tx.semanas.findFirst({
      where: {
        negocio_id: negocioId,
        fecha_inicio: { lte: fecha },
        fecha_fin: { gte: fecha },
      },
      select: { id: true, estado: true },
    });
    if (!semana) throw new HttpError(409, 'No existe una semana para la fecha de la compra');
    if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana de la compra está cerrada');

    const origen = await tx.ubicaciones_fondos.findFirst({
      where: { id: input.origen_pago_id, negocio_id: negocioId, activo: true },
      select: { id: true, tipo: true },
    });
    if (!origen) throw new HttpError(400, 'La ubicación de pago no pertenece al negocio o está inactiva');

    if (ticketRef) {
      const repetida = await tx.purchases.findFirst({
        where: { negocio_id: negocioId, ticket_ref: ticketRef },
        select: { id: true },
      });
      if (repetida) throw new HttpError(409, `El ticket ${ticketRef} ya fue registrado`);
    }

    const productIds = [...new Set(input.lineas.map((l) => l.product_id.toString()))].map(BigInt);
    const productos = await tx.products.findMany({
      where: { negocio_id: negocioId, id: { in: productIds }, active: true },
      select: { id: true },
    });
    const validos = new Set(productos.map((p) => p.id.toString()));
    const faltantes = productIds.filter((id) => !validos.has(id.toString()));
    if (faltantes.length) throw new HttpError(400, `Producto no válido para este negocio: ${faltantes.map(String).join(', ')}`);

    const bodega = await tx.zonas_inventario.findFirst({
      where: { negocio_id: negocioId, nombre: 'Bodega' },
      select: { id: true },
    });
    if (!bodega) throw new HttpError(409, 'El negocio no tiene configurada la zona Bodega');

    const totalCalculado = input.lineas.reduce(
      (sum, linea) => sum + (linea.importe ?? linea.cantidad_base * linea.costo_unitario_base),
      0,
    );
    const compra = await tx.purchases.create({
      data: {
        negocio_id: negocioId,
        fecha_recepcion: fecha,
        proveedor: input.proveedor?.trim() || null,
        ticket_ref: ticketRef,
        total: input.total ?? totalCalculado,
        moneda: input.moneda ?? 'MXN',
        fuente: input.fuente ?? 'manual',
        notas: input.notas?.trim() || null,
        origen_pago_id: origen.id,
        confirmada_por: input.usuario_id,
        confirmada_at: new Date(),
      },
    });

    const lotes = [] as { id: bigint; product_id: bigint; cantidad_inicial: Prisma.Decimal; costo_unitario: Prisma.Decimal }[];
    for (const linea of input.lineas) {
      const importe = linea.importe ?? linea.cantidad_base * linea.costo_unitario_base;
      // Si llega el importe real del ticket, el costo FIFO debe quedar en
      // unidad base. El precio capturado puede ser el de una botella, bolsa o
      // caja; por eso se deriva como importe / cantidad_base.
      const costoBase = linea.importe == null ? linea.costo_unitario_base : importe / linea.cantidad_base;
      await tx.purchase_lines.create({
        data: {
          purchase_id: compra.id,
          product_id: linea.product_id,
          qty: linea.cantidad_base,
          unidad_compra: linea.unidad_compra ?? null,
          contenido_compra: linea.contenido_compra ?? null,
          costo_unitario: costoBase,
          importe,
        },
      });
      const lote = await tx.inventory_lots.create({
        data: {
          negocio_id: negocioId,
          product_id: linea.product_id,
          purchase_id: compra.id,
          zona_id: bodega.id,
          recibido_at: fecha,
          cantidad_inicial: linea.cantidad_base,
          cantidad_restante: linea.cantidad_base,
          costo_unitario: costoBase,
          moneda: input.moneda ?? 'MXN',
          fuente: input.fuente ?? 'manual',
          ticket_ref: ticketRef,
          notas: input.notas?.trim() || null,
        },
        select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
      });
      lotes.push(lote);
    }

    // La ruta directa conserva la misma invariante que la captura rápida:
    // compra, lote FIFO y salida de caja/banco nacen en una transacción única.
    await tx.movimientos.create({
      data: {
        negocio_id: negocioId,
        semana_id: semana.id,
        fecha,
        tipo: 'compra_inventario',
        monto: input.total ?? totalCalculado,
        ubicacion_origen_id: origen.id,
        facturado: origen.tipo === 'banco',
        descripcion: `Compra ticket ${ticketRef ?? compra.id}`,
        usuario_id: input.usuario_id,
        compra_id: compra.id,
      },
    });
    if (origen.tipo === 'banco') await asegurarFacturasBanco(negocioId, tx);
    await registrarAuditoria({ negocioId, usuarioId: input.usuario_id, entidad: 'compra', entidadId: compra.id, accion: 'crear_confirmada', despues: { total: input.total ?? totalCalculado, origen_pago_id: origen.id, lineas: input.lineas.length } }, tx);

    return {
      purchase_id: Number(compra.id),
      fecha_recepcion: input.fecha_recepcion,
      total: Number(compra.total ?? totalCalculado),
      lotes: lotes.map((l) => ({
        id: Number(l.id),
        product_id: Number(l.product_id),
        cantidad_inicial: Number(l.cantidad_inicial),
        costo_unitario: Number(l.costo_unitario),
      })),
    };
  }, { timeout: 30_000, maxWait: 15_000 });
  // Una compra confirmada puede resolver excepciones anteriores. El lote queda
  // disponible de inmediato y el recálculo respeta la fecha de recepción.
  const costeoEnVivo = await costearVentasPendientesEnVivo({ negocioId });
  return { ...resultado, costeo_en_vivo: costeoEnVivo };
}

export async function listarLotes(negocioId: bigint, productId?: bigint) {
  const lotes = await prisma.inventory_lots.findMany({
    where: { negocio_id: negocioId, ...(productId ? { product_id: productId } : {}) },
    include: { products: { select: { name: true, unidad_base: true } }, zona: { select: { nombre: true } } },
    orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
  });
  return lotes.map((l) => ({
    id: Number(l.id),
    product_id: Number(l.product_id),
    producto: l.products.name,
    unidad_base: l.products.unidad_base,
    recibido_at: l.recibido_at.toISOString().slice(0, 10),
    cantidad_inicial: Number(l.cantidad_inicial),
    cantidad_restante: Number(l.cantidad_restante),
    costo_unitario: Number(l.costo_unitario),
    estado: l.estado,
    zona_id: l.zona_id == null ? null : Number(l.zona_id),
    zona: l.zona?.nombre ?? null,
    ticket_ref: l.ticket_ref,
  }));
}
