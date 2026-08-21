import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

type CriterioCosto = 'catalogo';
type ModoApertura = 'normal' | 'historico_prueba';

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convierte el snapshot de apertura de una semana en lotes FIFO iniciales.
 *
 * El snapshot sigue siendo la fuente física histórica. Los lotes creados aquí
 * sólo hacen explícito el costo con el que esa existencia entra al libro FIFO;
 * no crean un movimiento financiero ni vuelven a contar la compra.
 */
export async function prepararAperturaFifo(input: {
  negocioId: bigint;
  semanaId: bigint;
  criterio?: CriterioCosto;
  modo?: ModoApertura;
}) {
  const criterio = input.criterio ?? 'catalogo';
  const modo = input.modo ?? 'normal';
  if (criterio !== 'catalogo') throw new HttpError(400, 'Criterio de costo de apertura no soportado');

  return prisma.$transaction(async (tx) => {
    const semana = await tx.semanas.findFirst({
      where: { id: input.semanaId, negocio_id: input.negocioId },
      include: { inventario_semanal: true },
    });
    if (!semana) throw new HttpError(404, 'Semana no encontrada');
    if (!semana.inventario_semanal?.apertura_snapshot_id) {
      throw new HttpError(409, 'La semana no tiene snapshot de inventario de apertura');
    }

    const referencia = modo === 'historico_prueba'
      ? `APERTURA-FIFO-HISTORICO-${semana.id}`
      : `APERTURA-FIFO-${semana.id}`;
    const fuente = modo === 'historico_prueba' ? 'historico_prueba' : 'inventario_inicial';
    const existentes = await tx.inventory_lots.findMany({
      where: { negocio_id: input.negocioId, fuente, ticket_ref: referencia },
      select: { id: true, product_id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true },
      orderBy: { id: 'asc' },
    });
    if (existentes.length) {
      return {
        estado: 'ya_preparada' as const,
        semana_id: Number(semana.id),
        snapshot_id: Number(semana.inventario_semanal.apertura_snapshot_id),
        referencia,
        lotes: existentes.map((l) => ({
          id: Number(l.id), product_id: Number(l.product_id),
          cantidad_inicial: Number(l.cantidad_inicial), cantidad_restante: Number(l.cantidad_restante),
          costo_unitario: Number(l.costo_unitario),
        })),
        faltantes_costo: [],
      };
    }

    const lineas = await tx.inventory_lines.findMany({
      where: { snapshot_id: semana.inventario_semanal.apertura_snapshot_id },
      select: { product_id: true, qty_captura: true, factor: true },
    });
    if (!lineas.length) throw new HttpError(409, 'El snapshot de apertura no tiene líneas');

    const productIds = [...new Set(lineas.map((l) => l.product_id.toString()))].map(BigInt);
    const productos = await tx.products.findMany({
      where: { negocio_id: input.negocioId, id: { in: productIds }, active: true },
      select: { id: true, name: true, unit_cost: true },
    });
    const porId = new Map(productos.map((p) => [p.id.toString(), p]));
    const cantidades = new Map<string, number>();
    for (const linea of lineas) {
      const cantidad = Number(linea.qty_captura) * Number(linea.factor);
      const key = linea.product_id.toString();
      cantidades.set(key, round((cantidades.get(key) ?? 0) + cantidad, 4));
    }

    const faltantesCosto: { product_id: number; producto: string; cantidad: number }[] = [];
    const lotes = [] as { product_id: bigint; cantidad: number; costo: number }[];
    for (const [key, cantidad] of cantidades) {
      if (cantidad <= 0) continue;
      const producto = porId.get(key);
      const costo = producto?.unit_cost == null ? null : Number(producto.unit_cost);
      if (!producto || costo == null || !Number.isFinite(costo) || costo < 0) {
        faltantesCosto.push({ product_id: Number(key), producto: producto?.name ?? `Producto ${key}`, cantidad });
        continue;
      }
      lotes.push({ product_id: BigInt(key), cantidad, costo: round(costo) });
    }
    if (faltantesCosto.length) {
      throw new HttpError(409, `Falta costo de catálogo para ${faltantesCosto.map((f) => f.producto).join(', ')}`);
    }

    const valor = round(lotes.reduce((sum, l) => sum + l.cantidad * l.costo, 0), 2);
    const creados = [] as { id: bigint; product_id: bigint; cantidad_inicial: Prisma.Decimal; costo_unitario: Prisma.Decimal }[];
    for (const lote of lotes) {
      const creado = await tx.inventory_lots.create({
        data: {
          negocio_id: input.negocioId,
          product_id: lote.product_id,
          recibido_at: semana.fecha_inicio,
          cantidad_inicial: lote.cantidad,
          cantidad_restante: lote.cantidad,
          costo_unitario: lote.costo,
          moneda: 'MXN',
          fuente,
          ticket_ref: referencia,
          notas: `${modo === 'historico_prueba' ? 'Prueba histórica aislada' : 'Apertura'} FIFO desde snapshot ${semana.inventario_semanal.apertura_snapshot_id}; costo ${criterio}`,
        },
        select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
      });
      creados.push(creado);
    }
    if (modo === 'normal') {
      await tx.inventario_semanal.update({
        where: { semana_id: semana.id },
        data: { apertura_origen: 'fifo_lotes_iniciales', apertura_valor: valor },
      });
    }
    return {
      estado: 'preparada' as const,
      semana_id: Number(semana.id),
      snapshot_id: Number(semana.inventario_semanal.apertura_snapshot_id),
      referencia,
      valor,
      lotes: creados.map((l) => ({ id: Number(l.id), product_id: Number(l.product_id), cantidad_inicial: Number(l.cantidad_inicial), cantidad_restante: Number(l.cantidad_inicial), costo_unitario: Number(l.costo_unitario) })),
      faltantes_costo: faltantesCosto,
    };
  }, { timeout: 30_000 });
}
