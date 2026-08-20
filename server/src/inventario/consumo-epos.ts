import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { convertirCantidad } from '../recetas/costeo.js';
import { consumirFIFO } from './fifo.js';

type DbClient = Prisma.TransactionClient | PrismaClient;

interface PlanConsumo {
  estado: 'costeable' | 'excepcion' | 'ya_costeada';
  error?: string;
  costoTotal: number;
  consumos: { productId: bigint; loteId: bigint; cantidad: number; costoUnitario: number; costoTotal: number }[];
}

function fechaISO(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function planificar(client: DbClient, negocioId: bigint, venta: { id: bigint; epos_product_id: number | null; producto_nombre: string; cantidad: Prisma.Decimal; fecha: Date }): Promise<PlanConsumo> {
  const previo = await client.inventory_consumptions.findFirst({ where: { negocio_id: negocioId, epos_venta_id: venta.id }, select: { id: true } });
  if (previo) return { estado: 'ya_costeada', costoTotal: 0, consumos: [] };

  const menu = await client.productos_menu.findFirst({
    where: {
      negocio_id: negocioId,
      activo: true,
      ...(venta.epos_product_id != null
        ? { OR: [{ epos_product_id: venta.epos_product_id }, { nombre: venta.producto_nombre }] }
        : { nombre: venta.producto_nombre }),
    },
    include: {
      recetas: {
        where: { estado: 'validada', OR: [{ vigente_desde: null }, { vigente_desde: { lte: venta.fecha } }] },
        orderBy: { version: 'desc' },
        take: 1,
        include: { lineas: { include: { products: { select: { id: true, name: true, unidad_base: true } } } } },
      },
    },
  });
  if (!menu) return { estado: 'excepcion', error: `Producto Epos sin mapeo: ${venta.producto_nombre}`, costoTotal: 0, consumos: [] };
  const receta = menu.recetas[0];
  if (!receta) return { estado: 'excepcion', error: `Sin receta validada: ${menu.nombre}`, costoTotal: 0, consumos: [] };

  const cantidadVendida = Number(venta.cantidad);
  if (!Number.isFinite(cantidadVendida) || cantidadVendida <= 0) return { estado: 'excepcion', error: `Cantidad inválida en venta: ${menu.nombre}`, costoTotal: 0, consumos: [] };

  const consumos: PlanConsumo['consumos'] = [];
  for (const linea of receta.lineas) {
    const unidadBase = linea.products.unidad_base;
    const cantidadBase = unidadBase ? convertirCantidad(Number(linea.cantidad) * cantidadVendida, linea.unidad, unidadBase) : null;
    if (cantidadBase == null) {
      return { estado: 'excepcion', error: `Unidad incompatible en ${menu.nombre}: ${linea.products.name} (${linea.unidad} → ${unidadBase ?? 'sin unidad'})`, costoTotal: 0, consumos: [] };
    }
    const lotes = await client.inventory_lots.findMany({
      where: { negocio_id: negocioId, product_id: linea.product_id, estado: 'abierto', cantidad_restante: { gt: 0 } },
      orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
      select: { id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true },
    });
    const resultado = consumirFIFO(lotes.map((lote) => ({
      id: Number(lote.id), recibidoAt: fechaISO(lote.recibido_at), cantidadRestante: Number(lote.cantidad_restante), costoUnitario: Number(lote.costo_unitario),
    })), cantidadBase);
    if (resultado.faltante > 0.0001) {
      return { estado: 'excepcion', error: `Inventario insuficiente: ${linea.products.name}; faltan ${resultado.faltante} ${unidadBase}`, costoTotal: 0, consumos: [] };
    }
    consumos.push(...resultado.consumos.map((c) => ({ productId: linea.product_id, loteId: BigInt(c.loteId), cantidad: c.cantidad, costoUnitario: c.costoUnitario, costoTotal: c.costoTotal })));
  }
  return { estado: 'costeable', costoTotal: Number(consumos.reduce((sum, c) => sum + c.costoTotal, 0).toFixed(4)), consumos };
}

/** Calcula o aplica consumo FIFO para ventas Epos ya importadas. */
export async function consumirVentasEpos(input: { negocioId: bigint; from: string; to: string; confirmar: boolean }) {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new HttpError(400, 'Periodo inválido');
  const ventas = await prisma.epos_ventas.findMany({ where: { negocio_id: input.negocioId, fecha: { gte: from, lt: to } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] });
  const resultado = { periodo: { from: input.from, to: input.to }, confirmar: input.confirmar, ventas: ventas.length, costeadas: 0, excepciones: 0, ya_costeadas: 0, costo_fifo: 0, detalle: [] as Record<string, unknown>[] };

  for (const venta of ventas) {
    const ejecutar = async (client: DbClient) => {
      const plan = await planificar(client, input.negocioId, venta);
      if (!input.confirmar || plan.estado !== 'costeable') return plan;
      for (const consumo of plan.consumos) {
        const actualizado = await client.inventory_lots.updateMany({ where: { id: consumo.loteId, negocio_id: input.negocioId, cantidad_restante: { gte: consumo.cantidad } }, data: { cantidad_restante: { decrement: consumo.cantidad } } });
        if (actualizado.count !== 1) throw new HttpError(409, 'El lote FIFO cambió mientras se procesaba; reintenta la venta');
        await client.inventory_consumptions.create({ data: { negocio_id: input.negocioId, product_id: consumo.productId, lote_id: consumo.loteId, epos_venta_id: venta.id, fecha: venta.fecha, cantidad: consumo.cantidad, costo_unitario: consumo.costoUnitario, costo_total: consumo.costoTotal, fuente: 'venta_receta' } });
      }
      await client.epos_ventas.update({ where: { id: venta.id }, data: { costo_fifo: plan.costoTotal, costeo_estado: 'costeada', costeo_error: null, costeado_at: new Date() } });
      return plan;
    };
    const plan = input.confirmar ? await prisma.$transaction((tx) => ejecutar(tx)) : await ejecutar(prisma);
    if (plan.estado === 'costeable') {
      resultado.costeadas += 1;
      resultado.costo_fifo += plan.costoTotal;
    } else if (plan.estado === 'ya_costeada') {
      resultado.ya_costeadas += 1;
    } else {
      resultado.excepciones += 1;
      if (input.confirmar) await prisma.epos_ventas.update({ where: { id: venta.id }, data: { costeo_estado: 'excepcion', costeo_error: plan.error } });
    }
    resultado.detalle.push({ venta_id: Number(venta.id), producto: venta.producto_nombre, estado: plan.estado, costo_fifo: plan.costoTotal, error: plan.error ?? null });
  }
  resultado.costo_fifo = Number(resultado.costo_fifo.toFixed(4));
  return resultado;
}
