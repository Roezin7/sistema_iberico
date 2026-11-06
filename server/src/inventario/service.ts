import { valorFifoAlCorte } from './consumo-epos.js';
import { bloquearLibro, exigirPeriodoMutable } from './control-cierre.js';
import { prisma } from '../db.js';
import { cargarLibroFisico, proyectarProducto, efectivaLote, q4 } from './libro-fisico.js';
import { valorSnapshotHistorico } from './costos-historicos.js';
import { instanteReal, referenciaDiaMexico, reconstruirZonas, type EventoFisico } from './cronologia.js';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import {
  totalBaseProducto,
  saldoZonaNormalizado,
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
import { filtroConsumoFifoActivo } from './fuentes.js';
import { convertirCantidad } from '../recetas/costeo.js';
import { normalizarNombreEpos } from '../epos/mapeo-menu.js';
import { registrarAuditoria } from '../lib/auditoria.js';

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
  /** Último costo unitario base registrado en un lote FIFO (referencia de compra). */
  ultimo_costo_fifo_base: number | null;
  ultimo_costo_fifo_fecha: string | null;
  unidad_base: string | null;
  contenido_compra: number | null;
  unidad_compra: string | null;
  rendimiento_util: number;
  /** Valor del físico operativo usando lotes FIFO, sólo como referencia de costo. */
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
  capas_costo_estimado: number;
  /** Existencia física operativa: último conteo + entradas - consumos. */
  existencia_fisica_base: number;
  existencia_fisica_operativa: number;
  /** Punto de partida físico antes de movimientos posteriores. */
  conteo_fisico_base: number;
  entradas_posteriores_base: number;
  consumos_posteriores_base: number;
  movimientos_no_cubiertos_base?: number;
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
  por_zona: { zona_id: number; zona: string; cantidad_base: number; qty_captura: number; factor: number; unidad_captura: string; contado_at?: string | null }[];
}

export interface InventarioActual {
  calculado_at?: string;
  recepciones_sin_hora?: number[];
  movimientos_pendientes?: { referencia: string; mensaje: string }[];
  snapshot_id: number | null;
  fecha: string | null;
  tipo: string | null;
  semana_id: number | null;
  productos: ProductoActual[];
  valor_total: number;
  /** Valuación FIFO del mismo físico operativo, sólo para comparar costos. */
  valor_fifo_total: number;
  valor_catalogo_total: number;
  /** Valuación del saldo FIFO operativo actual (no del último conteo). */
  valor_fifo_actual_total: number;
  valoracion_fifo: Awaited<ReturnType<typeof valorFifoAlCorte>> & { productos_con_diferencia_cantidad: number };
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
  cantidad_restante: PrismaTypes.Decimal | number;
  costo_unitario: PrismaTypes.Decimal | number;
  recibido_at: Date;
  id: bigint;
  fuente: string;
};

const ZONA_OPERATIVA = 'America/Mexico_City';

function fechaCivil(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_OPERATIVA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('No se pudo obtener la fecha operativa');
  return `${year}-${month}-${day}`;
}

/** El snapshot es un corte temporal, no sólo un corte de día.
 *
 * Una venta se descuenta únicamente si ocurrió después de que se guardó el
 * inventario físico. Esto también aplica a cierres oficiales: importar por la
 * noche una venta ocurrida antes del conteo no debe volver a bajar el físico,
 * mientras que una venta posterior al conteo sí representa una salida nueva.
 */
export function movimientoPosteriorAlSnapshot(fechaEvento: Date, _creadoAt: Date, snapshot: Date | null, _fechaCierre: string | null = null) {
  if (!snapshot) return true;
  return fechaEvento.getTime() > snapshot.getTime();
}

/** Variante para columnas PostgreSQL `date`: Prisma las materializa a
 * medianoche UTC. Para consumos ligados a una venta se debe pasar la fecha
 * real del ticket en `fechaEvento`; los consumos manuales sólo tienen día y
 * conservan el `creado_at` como mejor aproximación temporal. */
export function fechaDbPosteriorAlSnapshot(fechaDb: Date, creadoAt: Date, snapshot: Date | null, fechaCierre: string | null = null, fechaEvento: Date | null = null) {
  if (!snapshot) return true;
  if (fechaEvento) return fechaEvento.getTime() > snapshot.getTime();
  const evento = fechaDb.toISOString().slice(0, 10);
  const corte = fechaCivil(snapshot);
  if (fechaCierre) return evento > fechaCierre || (evento === fechaCierre && creadoAt > snapshot);
  return evento > corte || (evento === corte && creadoAt > snapshot);
}

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

/** Valor histórico: conserva también el formato y la vigencia del costo. */
export async function valorSnapshot(negocioId: bigint, snapshotId: bigint | null): Promise<number> {
  if (!snapshotId) return 0;
  return valorSnapshotHistorico(prisma, negocioId, snapshotId);
}

/**
 * Crea un snapshot completo a partir del inventario vigente por zona. Esto es
 * necesario porque los conteos normales pueden capturar una zona a la vez;
 * el cierre semanal debe congelar el estado agregado de todas las zonas.
 */
export async function crearSnapshotConsolidado(
  tx: PrismaTypes.TransactionClient,
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
    contado_at: actual.calculado_at ? new Date(actual.calculado_at) : snap.created_at,
  })));
  if (data.length) await tx.inventory_lines.createMany({ data });
  return snap;
}

/**
 * Inventario "actual" = el último conteo de cada zona (Bodega, Local, …),
 * agregado por producto, más las entradas físicas registradas después de ese
 * conteo, menos los consumos físicos posteriores. El conteo sigue siendo el
 * punto de partida; las compras confirmadas no se quedan sólo en FIFO.
 */
// Deduplica lecturas simultáneas. Varias pantallas montadas a la vez (o la
// existencia actual y la lista de compras abiertas juntas) deben compartir la
// misma consulta pesada; se elimina al terminar, así que nunca sirve datos
// obsoletos después de una mutación.
const inventarioEnVuelo = new Map<string, Promise<InventarioActual>>();

export function inventarioActual(negocioId: bigint, options: { semanaId?: bigint; hasta?: Date; vista?: 'fisica' | 'operativa' } = {}): Promise<InventarioActual> {
  // `vista` se conserva por compatibilidad de API, pero ambas vistas parten
  // del mismo inventario físico y sólo exponen campos distintos.
  // `vista` sólo cambia los campos presentados, no el cálculo fuente. Ignorar
  // esa bandera permite compartir la misma lectura pesada entre Inventario,
  // Lista de compras y Operación cuando llegan en paralelo.
  const key = `${negocioId}:${options.semanaId?.toString() ?? ''}:${options.hasta?.toISOString() ?? ''}`;
  const pendiente = inventarioEnVuelo.get(key);
  if (pendiente) return pendiente;
  const consulta = inventarioActualCalculado(negocioId, options);
  inventarioEnVuelo.set(key, consulta);
  void consulta.then(() => {
    if (inventarioEnVuelo.get(key) === consulta) inventarioEnVuelo.delete(key);
  }, () => {
    if (inventarioEnVuelo.get(key) === consulta) inventarioEnVuelo.delete(key);
  });
  return consulta;
}

async function inventarioActualCalculado(negocioId: bigint, options: { semanaId?: bigint; hasta?: Date; vista?: 'fisica' | 'operativa' } = {}): Promise<InventarioActual> {
  options = { ...options, hasta: options.hasta ?? new Date() };
  const [productos, snaps, lotesTodos, consumosPosteriores, ajustesInventario, zonasInventario, valoracionFifo] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      select: {
        id: true, name: true, store_id: true, base_qty: true, active: true,
        unit_cost: true, unidad_base: true, contenido_compra: true,
        unidad_compra: true, rendimiento_util: true, categoria_id: true, presentacion_modo: true,
        stores: { select: { id: true, name: true } },
        categorias_inventario: { select: { id: true, nombre: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory_snapshot.findMany({
      where: {
        negocio_id: negocioId,
        ...(options.semanaId != null ? { semana_id: options.semanaId } : {}),
      },
      select: { id: true, created_at: true, tipo: true, semana_id: true },
    }),
    prisma.inventory_lots.findMany({
      where: {
        negocio_id: negocioId,
      },
      select: { id: true, product_id: true, recibido_at: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, fuente: true, purchase_id: true, zona_id: true, estado: true, creado_at: true, disponible_desde: true,
        purchases: { select: { recibida_at: true } },
        transferencias: { orderBy: [{ fecha: 'asc' }, { id: 'asc' }], select: { zona_origen_id: true, zona_destino_id: true, cantidad: true, fecha: true, efectiva_at: true } },
      },
      orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
    }),
    prisma.inventory_consumptions.findMany({
      where: {
        negocio_id: negocioId,
        ...(options.hasta ? { fecha: { lte: options.hasta } } : {}),
        ...filtroConsumoFifoActivo({ incluirAjustes: true }),
      },
      // `fecha` es el día operativo en que ocurrió el consumo. `creado_at`
      // sólo indica cuándo se importó/costeó y puede ser posterior al conteo.
      select: {
        product_id: true, cantidad: true, fecha: true, creado_at: true, fuente: true, epos_venta_id: true,
        epos_venta: { select: { fecha: true } },
        lote: { select: { zona_id: true } },
      },
    }),
    prisma.inventory_adjustments.findMany({
      where: { negocio_id: negocioId },
      select: { product_id: true, cantidad_base: true, zona_id: true, snapshot_nuevo_id: true, creado_at: true },
    }),
    prisma.zonas_inventario.findMany({
      where: { negocio_id: negocioId },
      select: { id: true, nombre: true, orden: true },
      orderBy: { orden: 'asc' },
    }),
    valorFifoAlCorte(negocioId, options.hasta!),
  ]);

  const valorFifoPorProducto = new Map(valoracionFifo.productos.map(p => [p.product_id, p]));
  const lotes = lotesTodos.filter((lote) => lote.estado === 'abierto' && num0(lote.cantidad_restante) > 0 && (!options.hasta || efectivaLote(lote) <= options.hasta));
  const zonaBodegaGlobal = zonasInventario.find((zona) => zona.nombre.trim().toLowerCase() === 'bodega') ?? null;

  // El precio de compra sugerido debe ser el último precio realmente recibido
  // en FIFO, no el costo estático del catálogo. Preferimos un lote operativo
  // sobre uno marcado como prueba histórica; dentro de la misma fuente gana
  // la recepción más reciente.
  const ultimoLotePorProducto = new Map<string, typeof lotesTodos[number]>();
  for (const lote of lotesTodos) {
    if (lote.estado === 'cancelado') continue;
    const key = lote.product_id.toString();
    const previo = ultimoLotePorProducto.get(key);
    const esOperativo = lote.fuente !== 'historico_prueba';
    const previoOperativo = previo != null && previo.fuente !== 'historico_prueba';
    if (!previo || (esOperativo && !previoOperativo)
      || (esOperativo === previoOperativo && (lote.recibido_at > previo.recibido_at
        || (lote.recibido_at.getTime() === previo.recibido_at.getTime() && lote.id > previo.id)))) {
      ultimoLotePorProducto.set(key, lote);
    }
  }

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
    lotesPorProducto.set(key, operativos);
  }

  const metadataPorSnap = new Map(snaps.map((s) => [s.id.toString(), { tipo: s.tipo, semana_id: s.semana_id }]));
  const snapIds = snaps.map((s) => s.id);
  // Determinar el último snapshot por fecha real, no por el ID. Los IDs no
  // garantizan orden cronológico cuando se importan/restauran datos o se
  // corrige un conteo histórico. Así un snapshot vacío posterior no puede
  // ocultar el conteo válido más reciente de una zona.
  // Sólo necesitamos las líneas del snapshot más reciente de cada zona. La
  // consulta anterior descargaba todas las líneas históricas y después las
  // descartaba en memoria; con cierres semanales eso crecía sin límite.
  const todasLasLineas = snapIds.length
    ? await prisma.$queryRaw<Array<{
        snapshot_id: bigint;
        product_id: bigint;
        zona_id: bigint;
        qty_captura: PrismaTypes.Decimal | number;
        factor: PrismaTypes.Decimal | number;
        zona_nombre: string;
        zona_orden: number;
        snapshot_created_at: Date;
      }>>(Prisma.sql`
        WITH ultimos AS (
          SELECT DISTINCT ON (il.zona_id)
            il.zona_id, il.snapshot_id, COALESCE(il.contado_at, s.created_at) AS created_at
          FROM inventory_lines il
          JOIN inventory_snapshot s ON s.id = il.snapshot_id
          WHERE s.negocio_id = ${negocioId}
            ${options.semanaId != null ? Prisma.sql`AND s.semana_id = ${options.semanaId}` : Prisma.empty}
            ${options.hasta ? Prisma.sql`AND COALESCE(il.contado_at, s.created_at) <= ${options.hasta}` : Prisma.empty}
          ORDER BY il.zona_id, COALESCE(il.contado_at, s.created_at) DESC, il.snapshot_id DESC
        )
        SELECT il.snapshot_id, il.product_id, il.zona_id, il.qty_captura, il.factor,
               z.nombre AS zona_nombre, z.orden AS zona_orden,
               u.created_at AS snapshot_created_at
        FROM inventory_lines il
        JOIN ultimos u ON u.snapshot_id = il.snapshot_id AND u.zona_id = il.zona_id
        JOIN zonas_inventario z ON z.id = il.zona_id
      `)
    : [];
  const ultimoPorZona = new Map<string, { zona_id: bigint; snapshot_id: bigint; created_at: Date }>();
  for (const linea of todasLasLineas) {
    const key = linea.zona_id.toString();
    const anterior = ultimoPorZona.get(key);
    if (!anterior || linea.snapshot_created_at > anterior.created_at
      || (linea.snapshot_created_at.getTime() === anterior.created_at.getTime()
        && linea.snapshot_id > anterior.snapshot_id)) {
      ultimoPorZona.set(key, {
        zona_id: linea.zona_id,
        snapshot_id: linea.snapshot_id,
        created_at: linea.snapshot_created_at,
      });
    }
  }
  const pares = [...ultimoPorZona.values()];
  const snapshotVigente = new Map(pares.map((p) => [`${p.snapshot_id}:${p.zona_id}`, true]));
  const snapshotIdsVigentes = new Set(pares.map((p) => p.snapshot_id.toString()));
  // Los ajustes que crearon el snapshot vigente forman parte del conteo base,
  // aunque cada ajuste se haya dividido en varias filas de consumo/lote (una
  // por lote FIFO) unos milisegundos después. No se puede comparar la cantidad
  // de cada fila contra el total del ajuste: eso volvería a restar el rebase al
  // físico operativo cuando un producto cruza más de un lote.
  const ajustesConteoVigente = ajustesInventario.filter((ajuste) =>
    snapshotIdsVigentes.has(ajuste.snapshot_nuevo_id?.toString() ?? ''),
  );
  const esAjusteDelConteoVigente = (input: { product_id: bigint; cantidad: PrismaTypes.Decimal | number | null; creado_at: Date; fuente?: string | null }) => {
    if (input.fuente !== 'ajuste_inventario') return false;
    return ajustesConteoVigente.some((ajuste) =>
      ajuste.product_id === input.product_id
      && Math.abs(ajuste.creado_at.getTime() - input.creado_at.getTime()) <= 10_000);
  };
  const lineas = todasLasLineas
    .filter((linea) => snapshotVigente.has(`${linea.snapshot_id}:${linea.zona_id}`))
    .map((linea) => ({
      ...linea,
      zonas_inventario: { nombre: linea.zona_nombre, orden: linea.zona_orden },
      inventory_snapshot: { created_at: linea.snapshot_created_at },
    }));

  const zonaBodega = zonasInventario.find((zona) => zona.nombre.trim().toLowerCase() === 'bodega') ?? null;
  const unidadesCaptura = lineas.length || zonaBodega
    ? await prisma.product_zone_units.findMany({
        where: {
          product_id: { in: productos.map((p) => p.id) },
          zona_id: { in: [...new Set([...lineas.map((l) => l.zona_id), ...(zonaBodega ? [zonaBodega.id] : [])])] },
        },
        select: { product_id: true, zona_id: true, unidad_captura: true, factor: true },
      })
    : [];
  const unidadCapturaPorPar = new Map(unidadesCaptura.map((u) => [`${u.product_id}:${u.zona_id}`, { unidad: u.unidad_captura, factor: num0(u.factor) }]));

  // Fecha/snapshot a mostrar = el conteo por zona más reciente.
  let snapIdActual: bigint | null = null;
  let fechaActual: Date | null = null;
  for (const p of pares) {
    const f = p.created_at;
    if (f && (fechaActual == null || f > fechaActual)) {
      fechaActual = f;
      snapIdActual = p.snapshot_id;
    }
  }
  const corteInicial = pares.length ? new Date(Math.min(...pares.map(p => p.created_at.getTime()))) : null;
  const libro = await cargarLibroFisico(prisma, negocioId, options.hasta!, corteInicial ?? undefined);
  // Agrupar líneas por producto.
  const lineasPorProducto = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const k = l.product_id.toString();
    (lineasPorProducto.get(k) ?? lineasPorProducto.set(k, []).get(k)!).push(l);
  }

  const sinCosto: { product_id: number; nombre: string }[] = [];
  const result: ProductoActual[] = productos.map((p) => {
    const ls = lineasPorProducto.get(p.id.toString()) ?? [];
    const conteoFisicoBase = totalBaseProducto(
      ls.map((l) => ({ qty_captura: num0(l.qty_captura), factor: num0(l.factor) })),
    );
    const anclas = zonasInventario.map(z => ({
      zonaId: Number(z.id), nombre: z.nombre,
      corte: ultimoPorZona.get(z.id.toString())?.created_at ?? null,
      cantidad: ls.filter(l => l.zona_id === z.id).reduce((sum, l) => sum + num0(l.qty_captura) * num0(l.factor), 0),
    }));
    const reconstruido = proyectarProducto(anclas, libro.eventos, p.id, options.hasta!, new Set(pares.map(p => p.snapshot_id)));
    const entradasPosterioresBase = reconstruido.entradas;
    const consumosPosterioresBase = reconstruido.consumos;
    const totalBase = reconstruido.total;
    const zonasConEntradas = zonasInventario.map(z => ({
      zona_id: Number(z.id), zona: z.nombre, orden: z.orden,
      qty_base: reconstruido.saldos.get(Number(z.id)) ?? 0,
    }));
    const repartoFisico = reconstruido;
    const unitCostPresentation = num(p.unit_cost);
    const unitCostBase = costoUnitarioBase(p);
    const ultimoLote = ultimoLotePorProducto.get(p.id.toString());
    const lotesProducto = (lotesPorProducto.get(p.id.toString()) ?? []) as LoteValuacion[];
    // Conserva precisión hasta el total; redondear cada producto antes de
    // sumar puede desfasar el valor del snapshot oficial por algunos centavos.
    const valorCatalogo = unitCostBase == null ? 0 : totalBase * unitCostBase;
    const valorado = valorarFisicoConLotes(totalBase, lotesProducto, unitCostBase);
    const valoracionProducto = valorFifoPorProducto.get(Number(p.id));
    const existenciaFisicaBase = q4(totalBase);
    const existenciaFifoBase = valoracionProducto ? q4(valoracionProducto.cantidad) : null;
    const cantidadFifoOperativa = valoracionProducto
      ? cantidadOperativaInventario({ totalBase: valoracionProducto.cantidad, unidadBase: p.unidad_base, contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra) })
      : null;
    const valorFifoActual = valoracionProducto?.valor ?? null;
    const costoFifoBase = valoracionProducto && valoracionProducto.cantidad > 0 ? valoracionProducto.valor / valoracionProducto.cantidad : null;
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
      unidad_operativa: p.presentacion_modo === 'por_lote' && p.contenido_compra != null
        ? `equiv. de ${Number(p.contenido_compra)} ${p.unidad_base}`
        : unidadOperativaInventario(p.unidad_base, p.unidad_compra),
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
      ultimo_costo_fifo_base: ultimoLote == null ? null : Math.round(num0(ultimoLote.costo_unitario) * 1_000_000) / 1_000_000,
      ultimo_costo_fifo_fecha: ultimoLote?.recibido_at.toISOString().slice(0, 10) ?? null,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      unidad_compra: p.unidad_compra,
      rendimiento_util: num(p.rendimiento_util) ?? 1,
      // Conserva precisión por producto; los totales se redondean al final.
      valor_fifo: Math.round(valorado.valor * 1_000_000_000_000) / 1_000_000_000_000,
      valor_catalogo: valorCatalogo,
      costo_fifo_base: costoFifoBase == null ? null : Math.round(costoFifoBase * 1_000_000) / 1_000_000,
      cantidad_con_lote: Math.round(valorado.consumido * 1_000_000) / 1_000_000,
      cantidad_sin_lote: Math.round(Math.max(0, totalBase - valorado.consumido) * 1_000_000) / 1_000_000,
      cantidad_fifo_base: existenciaFifoBase,
      cantidad_fifo_operativa: cantidadFifoOperativa,
      valor_fifo_actual: valorFifoActual,
      capas_costo_estimado: valoracionProducto?.capas_estimadas ?? 0,
      existencia_fisica_base: existenciaFisicaBase,
      existencia_fisica_operativa: cantidadOperativaInventario({
        totalBase: existenciaFisicaBase,
        unidadBase: p.unidad_base,
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      conteo_fisico_base: q4(conteoFisicoBase),
      entradas_posteriores_base: q4(entradasPosterioresBase),
      consumos_posteriores_base: q4(consumosPosterioresBase),
      movimientos_no_cubiertos_base: q4(reconstruido.noCubierto),
      existencia_fifo_base: existenciaFifoBase,
      existencia_fifo_operativa: cantidadFifoOperativa,
      diferencia_fifo_vs_fisico_base: q4((existenciaFifoBase ?? 0) - existenciaFisicaBase),
      existencia_actual_base: existenciaFisicaBase,
      existencia_actual_operativa: cantidadOperativaInventario({
        totalBase: existenciaFisicaBase,
        unidadBase: p.unidad_base,
        contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      }),
      fuente_existencia_actual: 'fisico',
      fuente_valoracion: unitCostBase == null ? 'sin_costo' : 'catalogo',
      // La existencia física operativa se valora con el costo vigente del
      // catálogo. La valuación FIFO del mismo saldo se conserva en valor_fifo
      // como dato de auditoría; nunca cambia la cantidad física principal.
      valor: valorCatalogo,
      categoria_id: p.categoria_id ? Number(p.categoria_id) : null,
      categoria: p.categorias_inventario?.nombre ?? null,
      por_zona: zonasConEntradas.map((zona) => {
        const unidad = unidadCapturaPorPar.get(`${p.id}:${zona.zona_id}`);
        return {
          zona_id: zona.zona_id,
          zona: zona.zona,
          ...saldoZonaNormalizado(Math.max(0, repartoFisico.saldos.get(zona.zona_id) ?? zona.qty_base), p.unidad_base, unidad),
          contado_at: ultimoPorZona.get(String(zona.zona_id))?.created_at.toISOString() ?? null,
        };
      }),
    };
  });

  const valorTotal = Math.round(result.reduce((a, p) => a + p.valor, 0) * 100) / 100;
  const valorFifoTotal = Math.round(result.reduce((a, p) => a + p.valor_fifo, 0) * 100) / 100;
  const valorCatalogoTotal = Math.round(result.reduce((a, p) => a + p.valor_catalogo, 0) * 100) / 100;
  const valorFifoActualTotal = valoracionFifo.valor_monetario;
  const idsActivos = new Set(result.map(p => p.product_id));
  const productosConDiferencia = result.filter(p => Math.abs((p.cantidad_fifo_base ?? 0) - p.existencia_actual_base) > 0.0001).length
    + valoracionFifo.productos.filter(p => !idsActivos.has(p.product_id) && p.cantidad > 0.0001).length;
  const recepcionesSinHora = [...new Set(lotesTodos.filter(l => l.purchase_id != null && !l.purchases?.recibida_at && l.estado !== 'cancelado'
    && pares.some(z => fechaCivil(z.created_at) === l.recibido_at.toISOString().slice(0, 10))).map(l => Number(l.purchase_id)))];
  return {
    calculado_at: options.hasta!.toISOString(),
    recepciones_sin_hora: recepcionesSinHora,
    movimientos_pendientes: libro.errores,
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
    valoracion_fifo: { ...valoracionFifo, productos_con_diferencia_cantidad: productosConDiferencia },
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
    where: { negocio_id: negocioId, ...(semanaId == null ? {} : { OR: [{ semana_id: semanaId }, { aperturas_semanales: { some: { negocio_id: negocioId, semana_id: semanaId } } }, { cierres_semanales: { some: { negocio_id: negocioId, semana_id: semanaId } } }] }) },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: { inventory_lines: { select: { zona_id: true, contado_at: true } }, aperturas_semanales: { select: { semana_id: true } }, cierres_semanales: { select: { semana_id: true } } },
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
    oficial: row.aperturas_semanales.length > 0 || row.cierres_semanales.length > 0,
    oficial_para: [...row.aperturas_semanales.map(c => ({ tipo: 'apertura', semana_id: Number(c.semana_id) })), ...row.cierres_semanales.map(c => ({ tipo: 'cierre', semana_id: Number(c.semana_id) }))],
    zonas: [...new Map(row.inventory_lines.map(l => [Number(l.zona_id), { zona_id: Number(l.zona_id), contado_at: (l.contado_at ?? row.created_at).toISOString() }])).values()],
  }));
}

export interface CierreInventarioPreviewLinea {
  product_id: number;
  producto: string;
  unidad_base: string | null;
  unidad_operativa: string;
  apertura_base: number;
  compras_base: number;
  ajustes_base: number;
  consumo_teorico_base: number;
  esperado_base: number;
  esperado_operativo: number;
  costo_unitario_base: number | null;
  valor_esperado: number | null;
}

/**
 * Saldo que el operador debe confirmar al cerrar una semana.
 *
 * Este cálculo no toca snapshots ni FIFO: sólo expone la expectativa
 * independiente que se contrasta contra el conteo físico del cierre.
 */
export async function cierreInventarioPreview(negocioId: bigint, semanaId: bigint) {
  const semana = await prisma.semanas.findFirst({ where: { negocio_id: negocioId, id: semanaId } });
  const ciclo = await prisma.inventario_semanal.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } });
  if (!semana || !ciclo?.apertura_snapshot_id) throw new HttpError(409, 'La semana todavía no tiene inventario de apertura');
  const apertura = await prisma.inventory_snapshot.findUniqueOrThrow({ where: { id: ciclo.apertura_snapshot_id }, include: { inventory_lines: true } });
  const fin = new Date(semana.fecha_fin); fin.setUTCDate(fin.getUTCDate() + 1);
  const hasta = new Date(Math.min(Date.now(), new Date(`${fin.toISOString().slice(0,10)}T00:00:00-06:00`).getTime()));
  const limiteLegado = new Date(new Date(`${semana.fecha_inicio.toISOString().slice(0,10)}T00:00:00-06:00`).getTime()-1);
  const desde = new Date(Math.min(...apertura.inventory_lines.map(l => (l.contado_at ?? (apertura.semana_id !== semanaId ? limiteLegado : apertura.created_at)).getTime())));
  const [libro, productos] = await Promise.all([cargarLibroFisico(prisma, negocioId, hasta, desde), prisma.products.findMany({ where: { negocio_id: negocioId, active: true }, orderBy: { name: 'asc' } })]);
  const lineas = productos.map(p => {
    const anclas = libro.zonas.map(z => ({ zonaId: Number(z.id), nombre: z.nombre, corte: apertura.inventory_lines.find(l => l.zona_id === z.id)?.contado_at ?? (apertura.semana_id !== semanaId ? limiteLegado : apertura.created_at), cantidad: apertura.inventory_lines.filter(l => l.product_id === p.id && l.zona_id === z.id).reduce((s,l) => s + Number(l.qty_captura)*Number(l.factor),0) }));
    const saldo = proyectarProducto(anclas, libro.eventos, p.id, hasta, new Set([apertura.id]));
    const costo = costoUnitarioBase(p);
    return { product_id: Number(p.id), producto: p.name, unidad_base: p.unidad_base, unidad_operativa: unidadOperativaInventario(p.unidad_base, p.unidad_compra), apertura_base: anclas.reduce((s,a) => s+a.cantidad,0), compras_base: saldo.entradas, ajustes_base: 0, consumo_teorico_base: saldo.consumos, esperado_base: saldo.total, esperado_operativo: cantidadOperativaInventario({ totalBase: saldo.total, unidadBase: p.unidad_base, contenidoCompra: p.contenido_compra == null ? null : Number(p.contenido_compra) }), costo_unitario_base: costo, valor_esperado: costo == null ? null : saldo.total*costo };
  });
  return { semana_id: Number(semanaId), apertura_snapshot_id: Number(apertura.id), cierre_snapshot_id: ciclo.cierre_snapshot_id == null ? null : Number(ciclo.cierre_snapshot_id), corte_at: hasta.toISOString(), formula: 'físico inicial + entradas − ventas por receta − salidas operativas, por hora y zona', lineas, productos: lineas.length, consumo_teorico_base: lineas.reduce((s,l)=>s+l.consumo_teorico_base,0), valor_esperado: lineas.reduce((s,l)=>s+(l.valor_esperado??0),0), valor_estimado: true, advertencias: libro.errores };
}

/** Lista de compras: faltantes contra el inventario físico, agrupados por tienda.
 * FIFO sólo se consulta como auditoría y nunca cambia la sugerencia de compra.
 */
export function listaComprasDesdeInventario(actual: InventarioActual) {
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
    // Para decidir cuánto presupuestar usamos el último precio recibido en
    // FIFO. Si todavía no existe un lote, conservamos el costo del catálogo
    // como respaldo explícito para no ocultar productos sin precio.
    const costoBaseReferencia = p.ultimo_costo_fifo_base ?? p.unit_cost_base;
    const costoPresentacionReferencia = p.ultimo_costo_fifo_base != null && p.contenido_compra != null
      ? redondear(p.ultimo_costo_fifo_base * p.contenido_compra * (p.rendimiento_util || 1))
      : p.unit_cost;
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
      unit_cost: costoPresentacionReferencia,
      unit_cost_base: costoBaseReferencia,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra,
      unidad_compra: p.unidad_compra,
      rendimiento_util: p.rendimiento_util,
      presentaciones_faltantes: presentaciones,
      costo_configurado: costoBaseReferencia != null,
      fuente_costo: p.ultimo_costo_fifo_base != null ? 'ultimo_fifo' : p.unit_cost_base != null ? 'catalogo' : 'sin_costo',
      ultimo_costo_fifo_base: p.ultimo_costo_fifo_base,
      ultimo_costo_fifo_fecha: p.ultimo_costo_fifo_fecha,
      // La lista propone compras completas. El valor interno sigue usando la
      // unidad base para validar, pero el importe visible corresponde a las
      // presentaciones que realmente se comprarían.
      valor_faltante: presentaciones != null && costoPresentacionReferencia != null
        ? Math.round(presentaciones * costoPresentacionReferencia * 100) / 100
        : valorProducto(faltante, costoBaseReferencia),
    };
  });
  return armarListaCompras(faltantes);
}

export async function listaCompras(negocioId: bigint) {
  return listaComprasDesdeInventario(await inventarioActual(negocioId, { vista: 'operativa' }));
}

export interface LineaConteoInput {
  product_id: number;
  zona_id: number;
  qty_captura: number;
  /** Contenido físico explícito para tamaños mezclados; evita asumir botellas. */
  cantidad_base?: number;
}

export type TipoSnapshotInventario = 'apertura' | 'cierre' | 'ajuste' | 'conteo_operativo';

export interface MetadataSnapshotInventario {
  contado_at?: string | null;
  tipo: TipoSnapshotInventario;
  semana_id?: number | null;
  /** ID del snapshot anterior cuando el conteo se guarda por zonas. */
  continuar_snapshot_id?: number | null;
  motivo?: string | null;
  nota?: string | null;
  /** `operativa` recibe piezas físicas y convierte al formato histórico al guardar. */
  unidad_conteo?: 'captura' | 'operativa';
  usuario_id?: bigint | null;
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
  const contadoAt = instanteReal(metadata.contado_at) ?? new Date();
  if (lineasInput.length === 0) {
    throw new HttpError(400, 'El conteo no tiene líneas');
  }
  if (metadata.tipo === 'conteo_operativo') {
    throw new HttpError(400, 'El conteo operativo ya no está disponible. Usa apertura, cierre o ajuste documentado.');
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
    if (l.cantidad_base != null) {
      if (!Number.isFinite(l.cantidad_base) || l.cantidad_base < 0) throw new HttpError(400, 'Cantidad base de conteo inválida');
      // qty_captura conserva dos decimales. Dividir un peso medido entre el
      // tamaño del envase redondearía fracciones y alteraría el conteo real.
      return { ...l, qty_captura: l.cantidad_base, factor: 1 };
    } else if (metadata.unidad_conteo === 'operativa') {
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

  // Un ajuste puntual no debe borrar los demás productos de esa zona. El
  // nuevo corte conserva su saldo físico actual, incluidos movimientos ya
  // contemplados, y reemplaza únicamente los renglones corregidos.
  const saldoAnterior = metadata.tipo === 'ajuste' && metadata.continuar_snapshot_id == null
    ? await inventarioActual(negocioId, { vista: 'fisica', hasta: contadoAt }) : null;
  const conservadas = saldoAnterior?.productos.flatMap((p) => p.por_zona
    .filter((z) => zonaIds.includes(BigInt(z.zona_id)))
    .map((z) => ({ product_id: BigInt(p.product_id), zona_id: BigInt(z.zona_id), qty_captura: z.qty_captura, factor: z.factor }))) ?? [];

  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearLibro(tx, negocioId);
    await exigirPeriodoMutable(tx, negocioId, contadoAt);
    const semanaId = metadata.semana_id == null ? null : BigInt(metadata.semana_id);
    if (semanaId && metadata.tipo !== 'ajuste' && await tx.inventory_control_closures.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } })) throw new HttpError(409, 'El inventario de esta semana ya fue conciliado');
    if (semanaId != null) {
      await tx.$queryRaw`SELECT id FROM semanas WHERE id = ${semanaId} AND negocio_id = ${negocioId} FOR UPDATE`;
      const semana = await tx.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId }, select: { estado: true } });
      if (metadata.tipo !== 'ajuste' && semana?.estado !== 'abierta') throw new HttpError(409, 'El conteo oficial requiere una semana abierta');
    }
    const continuarSnapshotId = metadata.continuar_snapshot_id == null ? null : BigInt(metadata.continuar_snapshot_id);
    const snapshotAnterior = continuarSnapshotId == null
      ? null
      : await tx.inventory_snapshot.findFirst({
          where: {
            id: continuarSnapshotId,
            negocio_id: negocioId,
            tipo: metadata.tipo,
            semana_id: semanaId,
          },
          select: { id: true, motivo: true, nota: true, created_at: true },
        });
    if (continuarSnapshotId != null && snapshotAnterior == null) {
      throw new HttpError(409, 'El conteo anterior no existe o no pertenece a la misma semana y tipo.');
    }

    // Una semana sólo puede tener una apertura y un cierre oficiales. Si el
    // usuario continúa otra zona, el puntero debe seguir apuntando al snapshot
    // que se está completando; de esa forma Bodega y Local quedan en un único
    // conteo oficial sin permitir dos aperturas/cierres independientes.
    let semanal: { apertura_snapshot_id: bigint | null; cierre_snapshot_id: bigint | null } | null = null;
    if (metadata.semana_id != null && (metadata.tipo === 'apertura' || metadata.tipo === 'cierre')) {
      semanal = await tx.inventario_semanal.findFirst({
        where: { semana_id: BigInt(metadata.semana_id), negocio_id: negocioId },
        select: { apertura_snapshot_id: true, cierre_snapshot_id: true },
      });
      const existente = metadata.tipo === 'apertura' ? semanal?.apertura_snapshot_id : semanal?.cierre_snapshot_id;
      if (existente != null && existente !== continuarSnapshotId) {
        const nombre = metadata.tipo === 'apertura' ? 'apertura' : 'cierre';
        throw new HttpError(409, `La semana ya tiene un ${nombre} oficial (snapshot ${existente.toString()}). Usa "Ajuste documentado" para corregirlo sin romper la cadena.`);
      }
    }
    const lineasAnteriores = continuarSnapshotId == null
      ? conservadas
      : await tx.inventory_lines.findMany({
          where: { snapshot_id: continuarSnapshotId },
          select: { product_id: true, zona_id: true, qty_captura: true, factor: true, contado_at: true },
        });
    if (continuarSnapshotId != null && lineasAnteriores.some(l => zonaIds.includes(l.zona_id))) throw new HttpError(409, 'Esta zona ya fue guardada en el conteo. Usa un ajuste documentado para corregirla.');
    const reemplazos = new Set(lineasPersistidas.map((linea) => `${linea.product_id}:${linea.zona_id}`));
    const lineasConsolidadas = [
      ...lineasAnteriores.filter((linea) => !reemplazos.has(`${linea.product_id}:${linea.zona_id}`)).map(l => ({ ...l, contado_at: 'contado_at' in l && l.contado_at instanceof Date ? l.contado_at : snapshotAnterior?.created_at ?? contadoAt })),
      ...lineasPersistidas.map(l => ({ ...l, contado_at: contadoAt })),
    ];
    const snap = await tx.inventory_snapshot.create({ data: {
      negocio_id: negocioId,
      tipo: metadata.tipo,
      semana_id: semanaId,
      motivo: metadata.motivo?.trim() || snapshotAnterior?.motivo || null,
      nota: metadata.nota?.trim() || snapshotAnterior?.nota || null,
    } });
    await tx.inventory_lines.createMany({
      data: lineasConsolidadas.map((l) => ({
        snapshot_id: snap.id,
        product_id: BigInt(l.product_id),
        zona_id: BigInt(l.zona_id),
        qty_captura: l.qty_captura,
        factor: 'factor' in l ? l.factor : factorDe(l.product_id, l.zona_id),
        contado_at: l.contado_at,
      })),
    });
    if (semanaId != null && (metadata.tipo === 'apertura' || metadata.tipo === 'cierre')) {
      const valor = await valorSnapshotHistorico(tx, negocioId, snap.id);
      const data = metadata.tipo === 'apertura' ? { apertura_snapshot_id: snap.id, apertura_valor: valor, apertura_origen: 'conteo_fisico_oficial' } : { cierre_snapshot_id: snap.id, cierre_valor: valor };
      if (!semanal) await tx.inventario_semanal.create({ data: { negocio_id: negocioId, semana_id: semanaId, ...data } });
      else {
        const linked = await tx.inventario_semanal.updateMany({ where: { negocio_id: negocioId, semana_id: semanaId, ...(metadata.tipo === 'apertura' ? { apertura_snapshot_id: continuarSnapshotId } : { cierre_snapshot_id: continuarSnapshotId }) }, data });
        if (linked.count !== 1) throw new HttpError(409, 'El conteo cambió en otra sesión: vuelve a cargarlo');
      }
    }
    await registrarAuditoria({ negocioId, usuarioId: metadata.usuario_id, entidad: 'snapshot_inventario', entidadId: snap.id, accion: 'crear', despues: { tipo: metadata.tipo, semana_id: metadata.semana_id ?? null, contado_at: contadoAt.toISOString(), continuar_snapshot_id: metadata.continuar_snapshot_id ?? null, lineas: lineasInput.length, lineas_consolidadas: lineasConsolidadas.length, motivo: metadata.motivo ?? null } }, tx);
    return {
      snapshot_id: Number(snap.id),
      lineas: lineasInput.length,
      lineas_consolidadas: lineasConsolidadas.length,
      tipo: metadata.tipo,
      semana_id: metadata.semana_id ?? null,
      contado_at: contadoAt.toISOString(),
    };
  }, { timeout: 30000 });

  return resultado;
}
