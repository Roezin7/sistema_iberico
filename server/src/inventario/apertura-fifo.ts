import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

type CriterioCosto = 'catalogo';
type ModoApertura = 'normal' | 'historico_prueba';

/**
 * El catálogo conserva el precio y la presentación completa (botella, bolsa,
 * caja, etc.). El libro FIFO siempre trabaja en la unidad base que consumen
 * las recetas. La apertura debe convertir tanto el costo como la cantidad:
 * 3 botellas de 700 ml entran como 2,100 ml a costo por ml.
 */
export function costoUnitarioBaseDesdeCatalogo(input: {
  costoPresentacion: number;
  contenidoCompra?: number | null;
  rendimientoUtil?: number | null;
}) {
  const costo = Number(input.costoPresentacion);
  const contenido = Number(input.contenidoCompra ?? 1);
  const rendimiento = Number(input.rendimientoUtil ?? 1);
  if (!Number.isFinite(costo) || costo < 0) return null;
  if (!Number.isFinite(contenido) || contenido <= 0) return null;
  if (!Number.isFinite(rendimiento) || rendimiento <= 0 || rendimiento > 1) return null;
  return costo / (contenido * rendimiento);
}

// Correcciones confirmadas para reconstrucciones históricas. No alteran el
// catálogo global ni la apertura de la semana activa; se aplican únicamente
// al snapshot usado por el piloto histórico.
const CONTENIDO_HISTORICO_CONFIRMADO: Record<string, number> = {
  '13': 840,  // Arriero blanco del ticket histórico
  '24': 1700, // Sprite 1.7 L
  '27': 6000, // Agua mineral: paquete de 6 x 1 L
  '33': 1776, // Schweppes/Tónica: paquete de 6 x 296 ml
};

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function conversionAperturaDesdeCatalogo(input: {
  cantidadPresentaciones: number;
  factor?: number | null;
  contenidoCompra?: number | null;
  rendimientoUtil?: number | null;
  modo?: ModoApertura;
}) {
  const cantidad = Number(input.cantidadPresentaciones);
  const factor = Number(input.factor ?? 1);
  const contenido = Number(input.contenidoCompra ?? 1);
  const rendimiento = Number(input.rendimientoUtil ?? 1);
  if (![cantidad, factor, contenido, rendimiento].every(Number.isFinite)) return null;
  if (cantidad < 0 || factor <= 0 || contenido <= 0 || rendimiento <= 0 || rendimiento > 1) return null;
  // El piloto histórico conserva el criterio que se usó al reconstruirlo;
  // la operación normal sí descuenta el rendimiento útil del catálogo.
  const factorBase = factor * contenido * (input.modo === 'historico_prueba' ? 1 : rendimiento);
  return round(cantidad * factorBase, 4);
}

/**
 * Convierte una línea ya persistida del snapshot a unidad base.
 * `inventory_lines` congela el factor de captura, por lo que el contenido de
 * la presentación no debe volver a aplicarse en la apertura FIFO.
 */
export function cantidadBaseDesdeLineaSnapshot(input: { qtyCaptura: number; factor: number }) {
  const cantidad = Number(input.qtyCaptura);
  const factor = Number(input.factor);
  if (!Number.isFinite(cantidad) || !Number.isFinite(factor) || cantidad < 0 || factor <= 0) return null;
  return round(cantidad * factor, 4);
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
      select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true, rendimiento_util: true },
    });
    const porId = new Map(productos.map((p) => [p.id.toString(), p]));
    const cantidades = new Map<string, number>();
    for (const linea of lineas) {
      const cantidad = cantidadBaseDesdeLineaSnapshot({
        qtyCaptura: Number(linea.qty_captura),
        factor: Number(linea.factor),
      });
      if (cantidad == null) continue;
      const key = linea.product_id.toString();
      cantidades.set(key, round((cantidades.get(key) ?? 0) + cantidad, 4));
    }

    // El libro FIFO es continuo. Si ya existe existencia abierta recibida
    // antes de esta apertura, esa existencia ya es el inventario que cruza la
    // semana y no debe materializarse otra vez desde el snapshot. Sólo se
    // crea un lote de arranque para un producto que todavía no tiene saldo en
    // el libro (por ejemplo, una alta física que aún no tenía lote).
    const lotesPrevios = modo === 'normal'
      ? await tx.inventory_lots.findMany({
        where: {
          negocio_id: input.negocioId,
          product_id: { in: productIds },
          recibido_at: { lte: semana.fecha_inicio },
          estado: 'abierto',
          cantidad_restante: { gt: 0 },
          // Los lotes históricos del piloto no bloquean la creación del lote
          // operativo correspondiente al snapshot físico de apertura.
          fuente: { not: 'historico_prueba' },
        },
        select: { product_id: true, cantidad_restante: true },
      })
      : [];
    const productosConSaldo = new Set(lotesPrevios.map((lote) => lote.product_id.toString()));
    const saldoPrevioPorProducto = new Map<string, number>();
    for (const lote of lotesPrevios) {
      const key = lote.product_id.toString();
      saldoPrevioPorProducto.set(key, round((saldoPrevioPorProducto.get(key) ?? 0) + Number(lote.cantidad_restante), 4));
    }
    const omitidos = new Set<string>();
    const diferenciasExistencia: { product_id: number; producto: string; fisico: number; fifo: number; diferencia: number }[] = [];

    const faltantesCosto: { product_id: number; producto: string; cantidad: number }[] = [];
    const lotes = [] as { product_id: bigint; cantidad: number; costo: number }[];
    for (const [key, cantidad] of cantidades) {
      if (cantidad <= 0) continue;
      if (modo === 'normal' && productosConSaldo.has(key)) {
        omitidos.add(key);
        const saldoFifo = saldoPrevioPorProducto.get(key) ?? 0;
        const diferencia = round(saldoFifo - cantidad, 4);
        if (Math.abs(diferencia) > 0.0001) {
          diferenciasExistencia.push({
            product_id: Number(key),
            producto: porId.get(key)?.name ?? `Producto ${key}`,
            fisico: cantidad,
            fifo: saldoFifo,
            diferencia,
          });
        }
        continue;
      }
      const producto = porId.get(key);
      const costo = producto?.unit_cost == null ? null : Number(producto.unit_cost);
      if (!producto || costo == null || !Number.isFinite(costo) || costo < 0) {
        faltantesCosto.push({ product_id: Number(key), producto: producto?.name ?? `Producto ${key}`, cantidad });
        continue;
      }
      // Tanto la prueba histórica como la operación normal guardan el conteo
      // físico en `inventory_lines` como qty_captura × factor. Ese producto
      // YA está en unidad base (g/ml/pieza); volver a multiplicarlo por
      // contenido_compra inflaría el lote (p. ej. 1 paquete × 400 g termina
      // erróneamente en 160,000 g). El contenido sólo se usa para convertir
      // el costo de la presentación a costo por unidad base.
      const contenidoHistorico = CONTENIDO_HISTORICO_CONFIRMADO[key] ?? (producto?.contenido_compra == null ? null : Number(producto.contenido_compra));
      const contenido = producto?.unidad_base && contenidoHistorico != null ? contenidoHistorico : 1;
      if (!Number.isFinite(contenido) || contenido <= 0) {
        faltantesCosto.push({ product_id: Number(key), producto: producto?.name ?? `Producto ${key}`, cantidad });
        continue;
      }
      const costoBase = modo === 'historico_prueba'
        ? costo / contenido
        : costoUnitarioBaseDesdeCatalogo({ costoPresentacion: costo, contenidoCompra: contenido, rendimientoUtil: producto?.rendimiento_util == null ? 1 : Number(producto.rendimiento_util) });
      if (costoBase == null) {
        faltantesCosto.push({ product_id: Number(key), producto: producto?.name ?? `Producto ${key}`, cantidad });
        continue;
      }
      // `cantidad` se obtuvo arriba como Σ(qty_captura × factor), por lo que
      // ya es cantidad base. No aplicar contenido_compra una segunda vez.
      lotes.push({ product_id: BigInt(key), cantidad, costo: round(costoBase, 6) });
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
    if (modo === 'normal' && !omitidos.size) {
      await tx.inventario_semanal.updateMany({
        where: { semana_id: semana.id, negocio_id: input.negocioId },
        data: { apertura_origen: 'fifo_lotes_iniciales', apertura_valor: valor },
      });
    }
    return {
      estado: 'preparada' as const,
      semana_id: Number(semana.id),
      snapshot_id: Number(semana.inventario_semanal.apertura_snapshot_id),
      referencia,
      valor,
      omitidos_por_lote_existente: [...omitidos].map(Number),
      diferencias_existencia_fifo: diferenciasExistencia,
      lotes: creados.map((l) => ({ id: Number(l.id), product_id: Number(l.product_id), cantidad_inicial: Number(l.cantidad_inicial), cantidad_restante: Number(l.cantidad_inicial), costo_unitario: Number(l.costo_unitario) })),
      faltantes_costo: faltantesCosto,
    };
  }, { timeout: 30_000 });
}
