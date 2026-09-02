import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import {
  totalBaseProducto,
  faltanteCompra,
  minimoBaseDesdePresentacion,
  presentacionesNecesarias,
  valorProducto,
  costoBaseDesdePresentacion,
  armarListaCompras,
  cantidadOperativaInventario,
  faltanteOperativoInventario,
  normalizarUnidadBase,
  unidadOperativaInventario,
  redondear,
  type ProductoFaltante,
} from './logic.js';

export interface ProductoActual {
  product_id: number;
  nombre: string;
  store_id: number;
  store: string;
  base_qty: number;
  /** Mínimo configurado convertido a unidad base. */
  minimo_base: number;
  total_base: number;
  /** Conteo visible: botellas, bolsas, paquetes o piezas. */
  unidad_operativa: string;
  minimo_operativo: number;
  total_operativo: number;
  unit_cost: number | null;
  unit_cost_base: number | null;
  unidad_base: string | null;
  contenido_compra: number | null;
  unidad_compra: string | null;
  rendimiento_util: number;
  /** Valor del conteo físico usando lotes FIFO, sólo como referencia de costo. */
  valor_fifo: number;
  /** Valor calculado con el costo vigente del catálogo. */
  valor_catalogo: number;
  /** Costo FIFO promedio informativo por unidad base. */
  costo_fifo_base: number | null;
  /** Parte del conteo físico que sí está cubierta por lotes abiertos. */
  cantidad_con_lote: number;
  /** Parte del conteo físico sin lote; se valora al catálogo y requiere conciliación. */
  cantidad_sin_lote: number;
  /** Saldo en unidad base de los lotes FIFO abiertos (compras menos consumos). */
  cantidad_fifo_base: number | null;
  /** Saldo FIFO convertido a la unidad que ve el operador. */
  cantidad_fifo_operativa: number | null;
  /** Valor de todos los lotes FIFO abiertos, sin truncarlo al conteo físico. */
  valor_fifo_actual: number | null;
  /** Existencia física del último conteo por zona. Fuente de verdad operativa. */
  existencia_fisica_base: number;
  existencia_fisica_operativa: number;
  /** Saldo del libro FIFO, usado únicamente como expectativa/auditoría. */
  existencia_fifo_base: number | null;
  existencia_fifo_operativa: number | null;
  diferencia_fifo_vs_fisico_base: number | null;
  /** Alias de compatibilidad: siempre representa el físico, nunca FIFO. */
  existencia_actual_base: number;
  existencia_actual_operativa: number;
  fuente_existencia_actual: 'fisico';
  /** Fuente de valuación del conteo físico (no de la expectativa FIFO). */
  fuente_valoracion: 'fifo' | 'catalogo' | 'mixta' | 'sin_costo';
  valor: number;
  categoria_id: number | null;
  categoria: string | null;
  por_zona: { zona_id: number; zona: string; qty_captura: number; factor: number; unidad_captura: string }[];
}

export interface InventarioActual {
  snapshot_id: number | null;
  fecha: string | null;
  tipo: string | null;
  semana_id: number | null;
  productos: ProductoActual[];
  valor_total: number;
  /** Valuación FIFO del mismo conteo físico, sólo para comparar costos. */
  valor_fifo_total: number;
  valor_catalogo_total: number;
  /** Valuación del saldo FIFO operativo actual (no del último conteo). */
  valor_fifo_actual_total: number;
  fuente_existencia_actual: 'fisico';
  sin_costo: { product_id: number; nombre: string }[];
}

/**
 * El catálogo guarda unit_cost como costo de la presentación de compra
 * (botella, bolsa, paquete). El inventario y FIFO trabajan en unidad base,
 * por lo que toda valuación de existencias debe usar el costo por unidad base.
 */
function costoUnitarioBase(producto: {
  unit_cost: unknown;
  unidad_base?: string | null;
  contenido_compra?: unknown;
}) {
  return costoBaseDesdePresentacion({
    costoPresentacion: producto.unit_cost == null ? null : Number(producto.unit_cost),
    contenidoCompra: producto.contenido_compra == null ? null : Number(producto.contenido_compra),
    unidadBase: producto.unidad_base,
  });
}

type LoteValuacion = {
  product_id: bigint;
  cantidad_restante: Prisma.Decimal | number;
  costo_unitario: Prisma.Decimal | number;
  recibido_at: Date;
  id: bigint;
  fuente: string;
};

/** Valora una existencia física usando lotes abiertos en orden FIFO.
 * Si el conteo físico excede el libro de lotes, el remanente se valora al
 * costo de catálogo y se devuelve como mezcla; nunca se omite silenciosamente.
 */
function valorarFisicoConLotes(cantidad: number, lotes: LoteValuacion[], costoCatalogo: number | null) {
  const operativos = lotes.filter((l) => num0(l.cantidad_restante) > 0);
  if (!operativos.length) return { valor: costoCatalogo == null ? 0 : cantidad * costoCatalogo, consumido: 0, fuente: costoCatalogo == null ? 'sin_costo' as const : 'catalogo' as const };
  let restante = Math.max(0, cantidad);
  let valor = 0;
  let consumido = 0;
  for (const lote of operativos) {
    if (restante <= 0) break;
    const qty = Math.min(restante, num0(lote.cantidad_restante));
    valor += qty * num0(lote.costo_unitario);
    consumido += qty;
    restante -= qty;
  }
  if (restante > 0 && costoCatalogo != null) valor += restante * costoCatalogo;
  const fuente: 'fifo' | 'mixta' = restante > 0 && costoCatalogo != null ? 'mixta' : 'fifo';
  return {
    valor,
    consumido,
    fuente,
  };
}

/** Valor de un snapshot histórico usando el costo vigente del catálogo. */
export async function valorSnapshot(negocioId: bigint, snapshotId: bigint | null): Promise<number> {
  if (!snapshotId) return 0;
  const lineas = await prisma.inventory_lines.findMany({
    where: { snapshot_id: snapshotId, inventory_snapshot: { negocio_id: negocioId } },
    include: { products: { select: { unit_cost: true, unidad_base: true, contenido_compra: true } } },
  });
  return Math.round(lineas.reduce((total, l) => {
    const costo = costoUnitarioBase(l.products);
    return total + (costo == null ? 0 : num0(l.qty_captura) * num0(l.factor) * costo);
  }, 0) * 100) / 100;
}

/**
 * Crea un snapshot completo a partir del inventario vigente por zona. Esto es
 * necesario porque los conteos normales pueden capturar una zona a la vez;
 * el cierre semanal debe congelar el estado agregado de todas las zonas.
 */
export async function crearSnapshotConsolidado(
  tx: Prisma.TransactionClient,
  negocioId: bigint,
  actual: InventarioActual,
  metadata: { tipo?: string; semana_id?: bigint | null; motivo?: string | null; nota?: string | null } = {},
) {
  const snap = await tx.inventory_snapshot.create({ data: {
    negocio_id: negocioId,
    tipo: metadata.tipo ?? 'conteo_operativo',
    semana_id: metadata.semana_id ?? null,
    motivo: metadata.motivo ?? null,
    nota: metadata.nota ?? null,
  } });
  const data = actual.productos.flatMap((p) => p.por_zona.map((z) => ({
    snapshot_id: snap.id,
    product_id: BigInt(p.product_id),
    zona_id: BigInt(z.zona_id),
    qty_captura: z.qty_captura,
    factor: z.factor,
  })));
  if (data.length) await tx.inventory_lines.createMany({ data });
  return snap;
}

/**
 * Inventario "actual" = el ÚLTIMO conteo de CADA zona (Bodega, Local, …) por
 * separado, agregado por producto. Volver a contar una zona reemplaza SOLO esa
 * zona: no borra lo ya contado en las demás.
 */
export async function inventarioActual(negocioId: bigint, options: { semanaId?: bigint; hasta?: Date; vista?: 'fisica' | 'operativa' } = {}): Promise<InventarioActual> {
  const [productos, snaps, lotes] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      include: { stores: true, categorias_inventario: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory_snapshot.findMany({
      where: {
        negocio_id: negocioId,
        ...(options.semanaId != null ? { semana_id: options.semanaId } : {}),
        ...(options.hasta ? { created_at: { lte: options.hasta } } : {}),
      },
      select: { id: true, created_at: true, tipo: true, semana_id: true },
    }),
    prisma.inventory_lots.findMany({
      where: {
        negocio_id: negocioId,
        estado: 'abierto',
        cantidad_restante: { gt: 0 },
        ...(options.hasta ? { recibido_at: { lte: options.hasta } } : {}),
      },
      select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true, fuente: true },
      orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
    }),
  ]);

  // No mezclar el libro histórico de pruebas con lotes operativos. Si un
  // producto ya tiene entradas reales, esas son la fuente de costo vigente.
  const lotesPorProducto = new Map<string, typeof lotes>();
  for (const lote of lotes) {
    const key = lote.product_id.toString();
    const lista = lotesPorProducto.get(key) ?? [];
    lista.push(lote);
    lotesPorProducto.set(key, lista);
  }
  for (const [key, lista] of lotesPorProducto) {
    const operativos = lista.filter((l) => l.fuente !== 'historico_prueba');
    if (operativos.length) lotesPorProducto.set(key, operativos);
  }

  const fechaPorSnap = new Map(snaps.map((s) => [s.id.toString(), s.created_at]));
  const metadataPorSnap = new Map(snaps.map((s) => [s.id.toString(), { tipo: s.tipo, semana_id: s.semana_id }]));
  const snapIds = snaps.map((s) => s.id);

  // Determinar el último snapshot por fecha real, no por el ID. Los IDs no
  // garantizan orden cronológico cuando se importan/restauran datos o se
  // corrige un conteo histórico. Así un snapshot vacío posterior no puede
  // ocultar el conteo válido más reciente de una zona.
  const todasLasLineas = snapIds.length
    ? await prisma.inventory_lines.findMany({
        where: { snapshot_id: { in: snapIds } },
        include: {
          zonas_inventario: true,
          inventory_snapshot: { select: { created_at: true } },
        },
      })
    : [];
  const ultimoPorZona = new Map<string, { zona_id: bigint; snapshot_id: bigint; created_at: Date }>();
  for (const linea of todasLasLineas) {
    const key = linea.zona_id.toString();
    const anterior = ultimoPorZona.get(key);
    if (!anterior || linea.inventory_snapshot.created_at > anterior.created_at
      || (linea.inventory_snapshot.created_at.getTime() === anterior.created_at.getTime()
        && linea.snapshot_id > anterior.snapshot_id)) {
      ultimoPorZona.set(key, {
        zona_id: linea.zona_id,
        snapshot_id: linea.snapshot_id,
        created_at: linea.inventory_snapshot.created_at,
      });
    }
  }
  const pares = [...ultimoPorZona.values()];
  const snapshotVigente = new Map(pares.map((p) => [`${p.snapshot_id}:${p.zona_id}`, true]));
  const lineas = todasLasLineas.filter((linea) => snapshotVigente.has(`${linea.snapshot_id}:${linea.zona_id}`));

  const unidadesCaptura = lineas.length
    ? await prisma.product_zone_units.findMany({
        where: {
          product_id: { in: lineas.map((l) => l.product_id) },
          zona_id: { in: lineas.map((l) => l.zona_id) },
        },
        select: { product_id: true, zona_id: true, unidad_captura: true },
      })
    : [];
  const unidadCapturaPorPar = new Map(unidadesCaptura.map((u) => [`${u.product_id}:${u.zona_id}`, u.unidad_captura]));

  // Fecha/snapshot a mostrar = el conteo por zona más reciente.
  let snapIdActual: bigint | null = null;
  let fechaActual: Date | null = null;
  for (const p of pares) {
    const f = fechaPorSnap.get(p.snapshot_id.toString());
    if (f && (fechaActual == null || f > fechaActual)) {
      fechaActual = f;
      snapIdActual = p.snapshot_id;
    }
  }

  // Agrupar líneas por producto.
  const lineasPorProducto = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const k = l.product_id.toString();
    (lineasPorProducto.get(k) ?? lineasPorProducto.set(k, []).get(k)!).push(l);
  }

  const sinCosto: { product_id: number; nombre: string }[] = [];
  const result: ProductoActual[] = productos.map((p) => {
    const ls = lineasPorProducto.get(p.id.toString()) ?? [];
    const totalBase = totalBaseProducto(
      ls.map((l) => ({ qty_captura: num0(l.qty_captura), factor: num0(l.factor) })),
    );
    const unitCostPresentation = num(p.unit_cost);
    const unitCostBase = costoUnitarioBase(p);
    const lotesProducto = (lotesPorProducto.get(p.id.toString()) ?? []) as LoteValuacion[];
    // Conserva precisión hasta el total; redondear cada producto antes de
    // sumar puede desfasar el valor del snapshot oficial por algunos centavos.
    const valorCatalogo = unitCostBase == null ? 0 : totalBase * unitCostBase;
    const valorado = valorarFisicoConLotes(totalBase, lotesProducto, unitCostBase);
    const cantidadesLotes = lotesProducto.reduce((a, l) => a + num0(l.cantidad_restante), 0);
    // El físico es la única existencia real para operación. FIFO se conserva
    // como expectativa/auditoría y nunca sustituye ni se suma al conteo.
    const existenciaFisicaBase = redondear(totalBase);
    const existenciaFifoBase = lotesProducto.length ? redondear(cantidadesLotes) : null;
    const cantidadFifoOperativa = lotesProducto.length
      ? cantidadOperativaInventario({
          totalBase: cantidadesLotes,
          unidadBase: p.unidad_base,
          contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
        })
      : null;
    const valorFifoActual = lotesProducto.length
      ? Math.round(lotesProducto.reduce((a, l) => a + num0(l.cantidad_restante) * num0(l.costo_unitario), 0) * 100) / 100
      : null;
    const costoFifoBase = cantidadesLotes > 0
      ? lotesProducto.reduce((a, l) => a + num0(l.cantidad_restante) * num0(l.costo_unitario), 0) / cantidadesLotes
      : null;
    if (unitCostBase == null && !lotesProducto.length) sinCosto.push({ product_id: Number(p.id), nombre: p.name });
    return {
      product_id: Number(p.id),
      nombre: p.name,
      store_id: Number(p.store_id),
      store: p.stores.name,
      base_qty: num0(p.base_qty),
      minimo_base: minimoBaseDesdePresentacion({
        minimoPresentaciones: num0(p.base_qty),
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      total_base: totalBase,
      unidad_operativa: unidadOperativaInventario(p.unidad_base, p.unidad_compra),
      minimo_operativo: num0(p.base_qty),
      total_operativo: cantidadOperativaInventario({
        totalBase,
        unidadBase: p.unidad_base,
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      // Se conserva unit_cost como costo de compra para la UI; la valuación
      // usa explícitamente el costo por unidad base.
      unit_cost: unitCostPresentation,
      unit_cost_base: unitCostBase,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      unidad_compra: p.unidad_compra,
      rendimiento_util: num(p.rendimiento_util) ?? 1,
      valor_fifo: Math.round(valorado.valor * 100) / 100,
      valor_catalogo: valorCatalogo,
      costo_fifo_base: costoFifoBase == null ? null : Math.round(costoFifoBase * 1_000_000) / 1_000_000,
      cantidad_con_lote: Math.round(valorado.consumido * 1_000_000) / 1_000_000,
      cantidad_sin_lote: Math.round(Math.max(0, totalBase - valorado.consumido) * 1_000_000) / 1_000_000,
      cantidad_fifo_base: lotesProducto.length ? Math.round(cantidadesLotes * 1_000_000) / 1_000_000 : null,
      cantidad_fifo_operativa: cantidadFifoOperativa,
      valor_fifo_actual: valorFifoActual,
      existencia_fisica_base: existenciaFisicaBase,
      existencia_fisica_operativa: cantidadOperativaInventario({
        totalBase: existenciaFisicaBase,
        unidadBase: p.unidad_base,
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      existencia_fifo_base: existenciaFifoBase,
      existencia_fifo_operativa: cantidadFifoOperativa,
      diferencia_fifo_vs_fisico_base: existenciaFifoBase == null ? null : redondear(existenciaFifoBase - existenciaFisicaBase),
      existencia_actual_base: existenciaFisicaBase,
      existencia_actual_operativa: cantidadOperativaInventario({
        totalBase: existenciaFisicaBase,
        unidadBase: p.unidad_base,
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      fuente_existencia_actual: 'fisico',
      fuente_valoracion: unitCostBase == null ? 'sin_costo' : 'catalogo',
      // La existencia física se valora con el costo vigente del catálogo para
      // mantenerla consistente con valorSnapshot y con el cierre oficial. La
      // valuación FIFO del mismo conteo se conserva en valor_fifo como dato de
      // auditoría; nunca cambia la cantidad ni el valor físico principal.
      valor: valorCatalogo,
      categoria_id: p.categoria_id ? Number(p.categoria_id) : null,
      categoria: p.categorias_inventario?.nombre ?? null,
      por_zona: ls.map((l) => ({
        zona_id: Number(l.zona_id),
        zona: l.zonas_inventario.nombre,
        qty_captura: num0(l.qty_captura),
        factor: num0(l.factor),
        unidad_captura: unidadCapturaPorPar.get(`${l.product_id}:${l.zona_id}`) ?? 'unidad base',
      })),
    };
  });

  const valorTotal = Math.round(result.reduce((a, p) => a + p.valor, 0) * 100) / 100;
  const valorFifoTotal = Math.round(result.reduce((a, p) => a + p.valor_fifo, 0) * 100) / 100;
  const valorCatalogoTotal = Math.round(result.reduce((a, p) => a + p.valor_catalogo, 0) * 100) / 100;
  const valorFifoActualTotal = Math.round(result.reduce((a, p) => a + (p.valor_fifo_actual ?? p.valor_fifo), 0) * 100) / 100;
  return {
    snapshot_id: snapIdActual != null ? Number(snapIdActual) : null,
    fecha: fechaActual ? fechaActual.toISOString() : null,
    tipo: snapIdActual != null ? metadataPorSnap.get(snapIdActual.toString())?.tipo ?? null : null,
    semana_id: snapIdActual != null && metadataPorSnap.get(snapIdActual.toString())?.semana_id != null
      ? Number(metadataPorSnap.get(snapIdActual.toString())!.semana_id)
      : null,
    productos: result,
    valor_total: valorTotal,
    valor_fifo_total: valorFifoTotal,
    valor_catalogo_total: valorCatalogoTotal,
    valor_fifo_actual_total: valorFifoActualTotal,
    fuente_existencia_actual: 'fisico',
    sin_costo: sinCosto,
  };
}

/** Historial explícito de snapshots: evita interpretar un conteo operativo
 * como apertura, cierre o ajuste. */
export async function listarSnapshots(
  negocioId: bigint,
  semanaId?: bigint,
) {
  const rows = await prisma.inventory_snapshot.findMany({
    where: { negocio_id: negocioId, semana_id: semanaId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: { inventory_lines: { select: { zona_id: true, product_id: true, qty_captura: true, factor: true } } },
    take: 200,
  });
  return rows.map((row) => ({
    id: Number(row.id),
    tipo: row.tipo,
    semana_id: row.semana_id == null ? null : Number(row.semana_id),
    motivo: row.motivo,
    nota: row.nota,
    creado_at: row.created_at.toISOString(),
    lineas: row.inventory_lines.length,
  }));
}

/** Lista de compras: faltantes contra el inventario físico, agrupados por tienda.
 * FIFO sólo se consulta como auditoría y nunca cambia la sugerencia de compra.
 */
export async function listaCompras(negocioId: bigint) {
  const actual = await inventarioActual(negocioId, { vista: 'operativa' });
  const faltantes: ProductoFaltante[] = actual.productos.map((p) => {
    // `base_qty` es el mínimo configurado en presentaciones de compra
    // (botellas, bolsas, paquetes, etc.). El conteo ya está normalizado a la
    // unidad base, por lo que primero convertimos el mínimo al mismo espacio.
    const minimoBase = p.minimo_base;
    const existenciaBaseActual = p.existencia_actual_base;
    const existenciaOperativaActual = p.existencia_actual_operativa;
    const faltante = faltanteCompra(minimoBase, existenciaBaseActual);
    const faltanteOperativo = faltanteOperativoInventario(p.minimo_operativo, existenciaOperativaActual);
    const presentaciones = presentacionesNecesarias(faltante, p.contenido_compra);
    return {
      product_id: p.product_id,
      nombre: p.nombre,
      store_id: p.store_id,
      store: p.store,
      base_qty: p.base_qty,
      minimo_base: minimoBase,
      total_base: p.total_base,
      faltante,
      unidad_operativa: p.unidad_operativa,
      minimo_operativo: p.minimo_operativo,
      total_operativo: p.total_operativo,
      existencia_actual_base: existenciaBaseActual,
      existencia_actual_operativa: existenciaOperativaActual,
      fuente_existencia_actual: p.fuente_existencia_actual,
      faltante_operativo: faltanteOperativo,
      unit_cost: p.unit_cost,
      unit_cost_base: p.unit_cost_base,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra,
      unidad_compra: p.unidad_compra,
      rendimiento_util: p.rendimiento_util,
      presentaciones_faltantes: presentaciones,
      costo_configurado: p.unit_cost_base != null,
      // La lista propone compras completas. El valor interno sigue usando la
      // unidad base para validar, pero el importe visible corresponde a las
      // presentaciones que realmente se comprarían.
      valor_faltante: presentaciones != null && p.unit_cost != null
        ? Math.round(presentaciones * p.unit_cost * 100) / 100
        : valorProducto(faltante, p.unit_cost_base),
    };
  });
  return armarListaCompras(faltantes);
}

export interface LineaConteoInput {
  product_id: number;
  zona_id: number;
  qty_captura: number;
}

export type TipoSnapshotInventario = 'apertura' | 'cierre' | 'ajuste' | 'conteo_operativo';

export interface MetadataSnapshotInventario {
  tipo: TipoSnapshotInventario;
  semana_id?: number | null;
  motivo?: string | null;
  nota?: string | null;
  /** `operativa` recibe piezas físicas y convierte al formato histórico al guardar. */
  unidad_conteo?: 'captura' | 'operativa';
}

/**
 * Crea un nuevo conteo (snapshot) con líneas por zona.
 * El factor se resuelve server-side desde product_zone_units (default 1) y se
 * "congela" en cada línea. Nunca sobrescribe snapshots previos (histórico).
 */
export async function crearConteo(
  negocioId: bigint,
  lineasInput: LineaConteoInput[],
  metadata: MetadataSnapshotInventario = { tipo: 'conteo_operativo' },
) {
  if (lineasInput.length === 0) {
    throw new HttpError(400, 'El conteo no tiene líneas');
  }
  if ((metadata.tipo === 'apertura' || metadata.tipo === 'cierre') && metadata.semana_id == null) {
    throw new HttpError(400, 'La apertura o cierre debe estar ligada a una semana');
  }
  if (metadata.tipo === 'ajuste' && !metadata.motivo?.trim()) {
    throw new HttpError(400, 'Un ajuste de inventario requiere motivo');
  }
  if (metadata.semana_id != null) {
    const semana = await prisma.semanas.findFirst({ where: { id: BigInt(metadata.semana_id), negocio_id: negocioId }, select: { id: true } });
    if (!semana) throw new HttpError(400, 'La semana del snapshot no pertenece al negocio');
  }

  const productIds = [...new Set(lineasInput.map((l) => BigInt(l.product_id)))];
  const zonaIds = [...new Set(lineasInput.map((l) => BigInt(l.zona_id)))];

  // Validar que productos y zonas pertenezcan al negocio.
  const [productos, zonas, pzus] = await Promise.all([
    prisma.products.findMany({ where: { id: { in: productIds }, negocio_id: negocioId }, select: { id: true, unidad_base: true, contenido_compra: true } }),
    prisma.zonas_inventario.findMany({ where: { id: { in: zonaIds }, negocio_id: negocioId }, select: { id: true } }),
    prisma.product_zone_units.findMany({
      where: { product_id: { in: productIds }, zona_id: { in: zonaIds } },
    }),
  ]);
  const productosOk = new Set(productos.map((p) => p.id.toString()));
  const zonasOk = new Set(zonas.map((z) => z.id.toString()));
  for (const l of lineasInput) {
    if (!productosOk.has(l.product_id.toString())) throw new HttpError(400, `Producto ${l.product_id} no pertenece al negocio`);
    if (!zonasOk.has(l.zona_id.toString())) throw new HttpError(400, `Zona ${l.zona_id} no pertenece al negocio`);
  }

  // Mapa de factor por (product, zona).
  const factorDe = (productId: number, zonaId: number): number => {
    const pzu = pzus.find((u) => u.product_id === BigInt(productId) && u.zona_id === BigInt(zonaId));
    return pzu ? num0(pzu.factor) : 1;
  };
  const productoDe = (productId: number) => productos.find((p) => p.id === BigInt(productId));
  const lineasPersistidas = lineasInput.map((l) => {
    const factor = factorDe(l.product_id, l.zona_id);
    const producto = productoDe(l.product_id);
    // En modo operativo el usuario siempre captura unidades físicas. El
    // snapshot, sin embargo, conserva la unidad de captura histórica para no
    // romper recetas ni FIFO. Convertimos primero a unidad base y después al
    // formato que espera inventory_lines (qty_captura × factor = base).
    let qtyCaptura = l.qty_captura;
    if (metadata.unidad_conteo === 'operativa') {
      const unidadBase = normalizarUnidadBase(producto?.unidad_base);
      const contenido = producto?.contenido_compra == null ? null : num0(producto.contenido_compra);
      const cantidadBase = unidadBase === 'pieza'
        ? l.qty_captura
        : contenido != null && contenido > 0
          ? l.qty_captura * contenido
          : l.qty_captura * factor;
      qtyCaptura = factor > 0 ? cantidadBase / factor : cantidadBase;
    }
    return { ...l, qty_captura: qtyCaptura };
  });

  return prisma.$transaction(async (tx) => {
    // Una semana sólo puede tener una apertura y un cierre oficiales. Si el
    // usuario necesita corregirlos, debe usar un ajuste documentado; de esa
    // forma nunca queda ambiguo qué conteo alimenta el FIFO de la semana.
    if (metadata.semana_id != null && (metadata.tipo === 'apertura' || metadata.tipo === 'cierre')) {
      const semanal = await tx.inventario_semanal.findFirst({
        where: { semana_id: BigInt(metadata.semana_id), negocio_id: negocioId },
        select: { apertura_snapshot_id: true, cierre_snapshot_id: true },
      });
      const existente = metadata.tipo === 'apertura' ? semanal?.apertura_snapshot_id : semanal?.cierre_snapshot_id;
      if (existente != null) {
        const nombre = metadata.tipo === 'apertura' ? 'apertura' : 'cierre';
        throw new HttpError(409, `La semana ya tiene un ${nombre} oficial (snapshot ${existente.toString()}). Usa "Ajuste documentado" para corregirlo sin romper la cadena.`);
      }
    }
    const snap = await tx.inventory_snapshot.create({ data: {
      negocio_id: negocioId,
      tipo: metadata.tipo,
      semana_id: metadata.semana_id == null ? null : BigInt(metadata.semana_id),
      motivo: metadata.motivo?.trim() || null,
      nota: metadata.nota?.trim() || null,
    } });
    await tx.inventory_lines.createMany({
      data: lineasPersistidas.map((l) => ({
        snapshot_id: snap.id,
        product_id: BigInt(l.product_id),
        zona_id: BigInt(l.zona_id),
        qty_captura: l.qty_captura,
        factor: factorDe(l.product_id, l.zona_id),
      })),
    });
    return {
      snapshot_id: Number(snap.id),
      lineas: lineasInput.length,
      tipo: metadata.tipo,
      semana_id: metadata.semana_id ?? null,
    };
  });
}
