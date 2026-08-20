import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

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
  return prisma.$transaction(async (tx) => {
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
      },
    });

    const lotes = [] as { id: bigint; product_id: bigint; cantidad_inicial: Prisma.Decimal; costo_unitario: Prisma.Decimal }[];
    for (const linea of input.lineas) {
      const importe = linea.importe ?? linea.cantidad_base * linea.costo_unitario_base;
      await tx.purchase_lines.create({
        data: {
          purchase_id: compra.id,
          product_id: linea.product_id,
          qty: linea.cantidad_base,
          unidad_compra: linea.unidad_compra ?? null,
          contenido_compra: linea.contenido_compra ?? null,
          costo_unitario: linea.costo_unitario_base,
          importe,
        },
      });
      const lote = await tx.inventory_lots.create({
        data: {
          negocio_id: negocioId,
          product_id: linea.product_id,
          purchase_id: compra.id,
          recibido_at: fecha,
          cantidad_inicial: linea.cantidad_base,
          cantidad_restante: linea.cantidad_base,
          costo_unitario: linea.costo_unitario_base,
          moneda: input.moneda ?? 'MXN',
          fuente: input.fuente ?? 'manual',
          ticket_ref: ticketRef,
          notas: input.notas?.trim() || null,
        },
        select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
      });
      lotes.push(lote);
    }

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
  });
}

export async function listarLotes(negocioId: bigint, productId?: bigint) {
  const lotes = await prisma.inventory_lots.findMany({
    where: { negocio_id: negocioId, ...(productId ? { product_id: productId } : {}) },
    include: { products: { select: { name: true, unidad_base: true } } },
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
    ticket_ref: l.ticket_ref,
  }));
}
