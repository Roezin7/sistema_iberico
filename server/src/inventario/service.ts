import { prisma } from '../db.js';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
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
  distribuirConsumoPorZona,
  type ProductoFaltante,
} from './logic.js';
import { filtroConsumoFifoActivo } from './fuentes.js';
import { convertirCantidad } from '../recetas/costeo.js';
import { normalizarNombreEpos } from '../epos/mapeo-menu.js';

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
  /** Existencia física operativa: último conteo + entradas - consumos. */
  existencia_fisica_base: number;
  existencia_fisica_operativa: number;
  /** Punto de partida físico antes de movimientos posteriores. */
  conteo_fisico_base: number;
  entradas_posteriores_base: number;
  consumos_posteriores_base: number;
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
  /** Valuación FIFO del mismo físico operativo, sólo para comparar costos. */
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

/** Las ventas del mismo día que se capturaron después del conteo también
 * deben bajar el físico; el instante de alta evita repetir ventas históricas
 * que sólo se importaron después. */
function movimientoPosteriorAlSnapshot(fechaEvento: Date, creadoAt: Date, snapshot: Date | null) {
  if (!snapshot) return true;
  const evento = fechaCivil(fechaEvento);
  const corte = fechaCivil(snapshot);
  return evento > corte || (evento === corte && creadoAt > snapshot);
}

/** Variante para columnas PostgreSQL `date`: Prisma las materializa a
 * medianoche UTC, así que aquí se conserva el día civil almacenado sin
 * convertirlo a la zona de México. */
function fechaDbPosteriorAlSnapshot(fechaDb: Date, creadoAt: Date, snapshot: Date | null) {
  if (!snapshot) return true;
  const evento = fechaDb.toISOString().slice(0, 10);
  const corte = fechaCivil(snapshot);
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
  const [productos, snaps, lotesTodos, consumosPosteriores, ajustesInventario] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      select: {
        id: true, name: true, store_id: true, base_qty: true, active: true,
        unit_cost: true, unidad_base: true, contenido_compra: true,
        unidad_compra: true, rendimiento_util: true, categoria_id: true,
        stores: { select: { id: true, name: true } },
        categorias_inventario: { select: { id: true, nombre: true } },
      },
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
        ...(options.hasta ? { recibido_at: { lte: options.hasta } } : {}),
      },
      select: { id: true, product_id: true, recibido_at: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, fuente: true, purchase_id: true, estado: true, creado_at: true },
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
      select: { product_id: true, cantidad: true, fecha: true, creado_at: true, fuente: true, epos_venta_id: true },
    }),
    prisma.inventory_adjustments.findMany({
      where: { negocio_id: negocioId },
      select: { product_id: true, cantidad_base: true, snapshot_nuevo_id: true, creado_at: true },
    }),
  ]);

  const lotes = lotesTodos.filter((lote) => lote.estado === 'abierto' && num0(lote.cantidad_restante) > 0);

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
    if (operativos.length) lotesPorProducto.set(key, operativos);
  }

  const fechaPorSnap = new Map(snaps.map((s) => [s.id.toString(), s.created_at]));
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
            il.zona_id, il.snapshot_id, s.created_at
          FROM inventory_lines il
          JOIN inventory_snapshot s ON s.id = il.snapshot_id
          WHERE s.negocio_id = ${negocioId}
            ${options.semanaId != null ? Prisma.sql`AND s.semana_id = ${options.semanaId}` : Prisma.empty}
            ${options.hasta ? Prisma.sql`AND s.created_at <= ${options.hasta}` : Prisma.empty}
          ORDER BY il.zona_id, s.created_at DESC, il.snapshot_id DESC
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

  // El físico no puede depender de que FIFO haya alcanzado a costear la
  // venta. Construimos el consumo de las recetas validadas directamente desde
  // Epos; si una venta está en excepción por falta de lote, aun así ya salió
  // físicamente del Local y después de la Bodega. El libro FIFO se conserva
  // como auditoría y sólo se usa como respaldo cuando no hay receta utilizable.
  const consumoVentaPorClave = new Map<string, number>();
  const consumoVentaPorProducto = new Map<string, number>();
  if (fechaActual != null) {
    // Las ventas anteriores al último conteo no pueden afectar la existencia
    // actual. Evitar traerlas también reduce el payload y el trabajo de
    // resolución de recetas conforme crece el histórico.
    const inicioVentas = new Date(`${fechaCivil(fechaActual)}T00:00:00Z`);
    const ventasPosteriores = await prisma.epos_ventas.findMany({
      where: {
        negocio_id: negocioId,
        fecha: { gte: inicioVentas, ...(options.hasta ? { lte: options.hasta } : {}) },
      },
      select: { id: true, fecha: true, creado_at: true, epos_product_id: true, producto_nombre: true, cantidad: true },
    });
    // La relación anidada de recetas es costosa en Prisma. Primero resolvemos
    // sólo el catálogo ligero y luego pedimos recetas para los menús que
    // realmente aparecen en las ventas desde el último snapshot.
    const menusBase = await prisma.productos_menu.findMany({
      where: { negocio_id: negocioId, activo: true },
      select: { id: true, nombre: true, epos_product_id: true },
    });
    const idsEpos = new Set(ventasPosteriores.map((venta) => venta.epos_product_id).filter((id): id is number => id != null));
    const nombresEpos = new Set(ventasPosteriores.map((venta) => normalizarNombreEpos(venta.producto_nombre)));
    const menusRelevantes = menusBase.filter((menu) => (menu.epos_product_id != null && idsEpos.has(menu.epos_product_id)) || nombresEpos.has(normalizarNombreEpos(menu.nombre)));
    const recetaLineas = menusRelevantes.length
      ? await prisma.$queryRaw<Array<{
          producto_menu_id: bigint;
          version: number;
          vigente_desde: Date | null;
          product_id: bigint;
          cantidad: PrismaTypes.Decimal | number;
          unidad: string;
          unidad_base: string | null;
        }>>(Prisma.sql`
          SELECT r.producto_menu_id, r.version, r.vigente_desde,
                 rl.product_id, rl.cantidad, rl.unidad, p.unidad_base
          FROM recetas r
          JOIN receta_lineas rl ON rl.receta_id = r.id
          JOIN products p ON p.id = rl.product_id
          WHERE r.estado = 'validada'
            AND r.producto_menu_id IN (${Prisma.join(menusRelevantes.map((menu) => menu.id))})
          ORDER BY r.producto_menu_id, r.version DESC
        `)
      : [];
    const recetasPorMenu = new Map<string, Array<{
      version: number;
      vigente_desde: Date | null;
      lineas: Array<{ product_id: bigint; cantidad: PrismaTypes.Decimal | number; unidad: string; products: { unidad_base: string | null } }>;
    }>>();
    for (const linea of recetaLineas) {
      const key = linea.producto_menu_id.toString();
      const recetas = recetasPorMenu.get(key) ?? [];
      let receta = recetas.find((item) => item.version === linea.version);
      if (!receta) {
        receta = { version: linea.version, vigente_desde: linea.vigente_desde, lineas: [] };
        recetas.push(receta);
      }
      receta.lineas.push({ product_id: linea.product_id, cantidad: linea.cantidad, unidad: linea.unidad, products: { unidad_base: linea.unidad_base } });
      recetasPorMenu.set(key, recetas);
    }
    const menusFisicos = menusRelevantes.map((menu) => ({ ...menu, recetas: recetasPorMenu.get(menu.id.toString()) ?? [] }));
    const menuPorId = new Map(menusFisicos.filter((m) => m.epos_product_id != null).map((m) => [m.epos_product_id!, m]));
    const menuPorNombre = new Map(menusFisicos.map((m) => [normalizarNombreEpos(m.nombre), m]));
    for (const venta of ventasPosteriores) {
      if (!movimientoPosteriorAlSnapshot(venta.fecha, venta.creado_at, fechaActual)) continue;
      const menu = (venta.epos_product_id == null ? null : menuPorId.get(venta.epos_product_id))
        ?? menuPorNombre.get(normalizarNombreEpos(venta.producto_nombre));
      const receta = menu?.recetas.find((candidate) => candidate.vigente_desde == null || candidate.vigente_desde <= venta.fecha);
      if (!receta) continue;
      const cantidadVendida = Number(venta.cantidad);
      if (!Number.isFinite(cantidadVendida) || cantidadVendida <= 0) continue;
      for (const linea of receta.lineas) {
        const cantidadBase = linea.products.unidad_base == null
          ? null
          : convertirCantidad(Number(linea.cantidad) * cantidadVendida, linea.unidad, linea.products.unidad_base);
        if (cantidadBase == null || cantidadBase <= 0) continue;
        const clave = `${venta.id}:${linea.product_id}`;
        consumoVentaPorClave.set(clave, (consumoVentaPorClave.get(clave) ?? 0) + cantidadBase);
        const producto = linea.product_id.toString();
        consumoVentaPorProducto.set(producto, (consumoVentaPorProducto.get(producto) ?? 0) + cantidadBase);
      }
    }
  }

  const consumoFifoSinRecetaPorProducto = new Map<string, number>();
  for (const consumo of consumosPosteriores) {
    if (consumo.epos_venta_id == null || !fechaDbPosteriorAlSnapshot(consumo.fecha, consumo.creado_at, fechaActual)) continue;
    const clave = `${consumo.epos_venta_id}:${consumo.product_id}`;
    // Una receta encontrada ya representa la salida física completa; no la
    // volvemos a sumar con su(s) lote(s) FIFO.
    if (consumoVentaPorClave.has(clave)) continue;
    const producto = consumo.product_id.toString();
    consumoFifoSinRecetaPorProducto.set(producto, (consumoFifoSinRecetaPorProducto.get(producto) ?? 0) + num0(consumo.cantidad));
  }

  // Agrupar una sola vez. Antes cada producto recorría todos los lotes y todos
  // los consumos para calcular sus entradas/salidas; con el histórico en
  // crecimiento eso convertía la lectura en O(productos × movimientos).
  const entradasPosterioresPorProducto = new Map<string, number>();
  for (const lote of lotesTodos) {
    if (lote.estado === 'cancelado'
      || lote.purchase_id == null && lote.fuente !== 'ajuste_inventario'
      || (fechaActual != null && lote.recibido_at <= fechaActual)
      || esAjusteDelConteoVigente({ product_id: lote.product_id, cantidad: lote.cantidad_inicial, creado_at: lote.creado_at, fuente: lote.fuente })) continue;
    const key = lote.product_id.toString();
    entradasPosterioresPorProducto.set(key, (entradasPosterioresPorProducto.get(key) ?? 0) + num0(lote.cantidad_inicial));
  }
  const consumosAjustesPorProducto = new Map<string, number>();
  for (const consumo of consumosPosteriores) {
    if (consumo.epos_venta_id != null
      || esAjusteDelConteoVigente({ product_id: consumo.product_id, cantidad: consumo.cantidad, creado_at: consumo.creado_at, fuente: consumo.fuente })
      || !fechaDbPosteriorAlSnapshot(consumo.fecha, consumo.creado_at, fechaActual)) continue;
    const key = consumo.product_id.toString();
    consumosAjustesPorProducto.set(key, (consumosAjustesPorProducto.get(key) ?? 0) + num0(consumo.cantidad));
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
    const conteoFisicoBase = totalBaseProducto(
      ls.map((l) => ({ qty_captura: num0(l.qty_captura), factor: num0(l.factor) })),
    );
    const entradasPosterioresBase = entradasPosterioresPorProducto.get(p.id.toString()) ?? 0;
    const consumosAjustesBase = consumosAjustesPorProducto.get(p.id.toString()) ?? 0;
    const consumosPosterioresBase = (consumoVentaPorProducto.get(p.id.toString()) ?? 0)
      + (consumoFifoSinRecetaPorProducto.get(p.id.toString()) ?? 0)
      + consumosAjustesBase;
    // No permitir existencia negativa: si los consumos superan el saldo
    // esperado, la diferencia se conserva en el contraste contra FIFO.
    const totalBase = Math.max(0, conteoFisicoBase + entradasPosterioresBase - consumosPosterioresBase);
    const zonasConEntradas = ls.map((l) => ({
      zona_id: Number(l.zona_id),
      zona: l.zonas_inventario.nombre,
      orden: l.zonas_inventario.orden,
      qty_base: num0(l.qty_captura) * num0(l.factor),
    }));
    // Las compras recibidas después del conteo entran físicamente a Bodega.
    // Si esa zona todavía no tiene línea, se conserva el total agregado y no
    // se inventa una línea histórica que el operador nunca contó.
    const bodega = zonasConEntradas.find((zona) => zona.zona.trim().toLowerCase() === 'bodega');
    if (bodega) bodega.qty_base += entradasPosterioresBase;
    const repartoFisico = distribuirConsumoPorZona(zonasConEntradas, consumosPosterioresBase);
    const unitCostPresentation = num(p.unit_cost);
    const unitCostBase = costoUnitarioBase(p);
    const ultimoLote = ultimoLotePorProducto.get(p.id.toString());
    const lotesProducto = (lotesPorProducto.get(p.id.toString()) ?? []) as LoteValuacion[];
    // Conserva precisión hasta el total; redondear cada producto antes de
    // sumar puede desfasar el valor del snapshot oficial por algunos centavos.
    const valorCatalogo = unitCostBase == null ? 0 : totalBase * unitCostBase;
    const valorado = valorarFisicoConLotes(totalBase, lotesProducto, unitCostBase);
    const cantidadesLotes = lotesProducto.reduce((a, l) => a + num0(l.cantidad_restante), 0);
    // Los costos de lote se almacenan con seis decimales, mientras que el
    // costo base del catálogo puede ser periódico (por ejemplo, $30 / 14).
    // Cuando todos los lotes están revaluados al catálogo y el saldo coincide
    // con el físico, usa el valor exacto del catálogo para evitar una brecha
    // artificial por la precisión limitada del almacenamiento.
    const lotesAlCostoActual = lotesProducto.length > 0 && unitCostBase != null
      && lotesProducto.every((l) => Math.abs(num0(l.costo_unitario) - unitCostBase) <= 0.0000011);
    const saldoFifoAlineado = lotesAlCostoActual && Math.abs(cantidadesLotes - totalBase) <= 0.0001;
    // El físico operativo parte del conteo y aplica las entradas/consumos
    // registrados. FIFO sigue siendo el libro de lotes y una auditoría, no una
    // segunda existencia que se sume por separado.
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
      // Conserva precisión por producto; el total se redondea una sola vez.
      // Así no se crea una brecha artificial por sumar centavos redondeados.
      ? saldoFifoAlineado
        ? valorCatalogo
        : Math.round(lotesProducto.reduce((a, l) => a + num0(l.cantidad_restante) * num0(l.costo_unitario), 0) * 1_000_000_000_000) / 1_000_000_000_000
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
      ultimo_costo_fifo_base: ultimoLote == null ? null : Math.round(num0(ultimoLote.costo_unitario) * 1_000_000) / 1_000_000,
      ultimo_costo_fifo_fecha: ultimoLote?.recibido_at.toISOString().slice(0, 10) ?? null,
      unidad_base: p.unidad_base,
      contenido_compra: p.contenido_compra == null ? null : Number(p.contenido_compra),
      unidad_compra: p.unidad_compra,
      rendimiento_util: num(p.rendimiento_util) ?? 1,
      // Conserva precisión por producto; los totales se redondean al final.
      valor_fifo: saldoFifoAlineado
        ? valorCatalogo
        : Math.round(valorado.valor * 1_000_000_000_000) / 1_000_000_000_000,
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
      conteo_fisico_base: redondear(conteoFisicoBase),
      entradas_posteriores_base: redondear(entradasPosterioresBase),
      consumos_posteriores_base: redondear(consumosPosterioresBase),
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
      // La existencia física operativa se valora con el costo vigente del
      // catálogo. La valuación FIFO del mismo saldo se conserva en valor_fifo
      // como dato de auditoría; nunca cambia la cantidad física principal.
      valor: valorCatalogo,
      categoria_id: p.categoria_id ? Number(p.categoria_id) : null,
      categoria: p.categorias_inventario?.nombre ?? null,
      por_zona: ls.map((l) => ({
        zona_id: Number(l.zona_id),
        zona: l.zonas_inventario.nombre,
        qty_captura: Math.max(0, (repartoFisico.saldos.get(Number(l.zona_id)) ?? num0(l.qty_captura) * num0(l.factor)) / Math.max(num0(l.factor), 0.0000001)),
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
  const semana = await prisma.semanas.findFirst({
    where: { id: semanaId, negocio_id: negocioId },
    select: { id: true, fecha_inicio: true, fecha_fin: true },
  });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  const ciclo = await prisma.inventario_semanal.findUnique({
    where: { semana_id: semanaId },
    select: { apertura_snapshot_id: true, cierre_snapshot_id: true },
  });
  if (!ciclo?.apertura_snapshot_id) {
    throw new HttpError(409, 'La semana todavía no tiene inventario de apertura');
  }

  const limite = new Date(`${semana.fecha_fin.toISOString().slice(0, 10)}T23:59:59.999Z`);
  const [productos, aperturaLineas, entradas, consumos, ajustesConsumo] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      select: { id: true, name: true, unidad_base: true, unidad_compra: true, contenido_compra: true, unit_cost: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory_lines.findMany({
      where: { snapshot_id: ciclo.apertura_snapshot_id },
      select: { product_id: true, qty_captura: true, factor: true },
    }),
    prisma.inventory_lots.findMany({
      where: {
        negocio_id: negocioId,
        recibido_at: { gte: semana.fecha_inicio, lte: limite },
        OR: [{ purchase_id: { not: null } }, { fuente: 'ajuste_inventario' }],
      },
      select: { product_id: true, cantidad_inicial: true, fuente: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limite },
        ...filtroConsumoFifoActivo(),
      },
      select: { product_id: true, cantidad: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limite },
        fuente: 'ajuste_inventario',
      },
      select: { product_id: true, cantidad: true },
    }),
  ]);

  const redondearCantidad = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
  const sumar = (mapa: Map<string, number>, productId: bigint, cantidad: number) => {
    const key = productId.toString();
    mapa.set(key, redondearCantidad((mapa.get(key) ?? 0) + cantidad));
  };
  const apertura = new Map<string, number>();
  for (const linea of aperturaLineas) sumar(apertura, linea.product_id, num0(linea.qty_captura) * num0(linea.factor));
  const compras = new Map<string, number>();
  const ajustes = new Map<string, number>();
  for (const entrada of entradas) {
    if (entrada.fuente === 'ajuste_inventario') sumar(ajustes, entrada.product_id, num0(entrada.cantidad_inicial));
    else sumar(compras, entrada.product_id, num0(entrada.cantidad_inicial));
  }
  for (const ajuste of ajustesConsumo) sumar(ajustes, ajuste.product_id, -num0(ajuste.cantidad));
  const consumo = new Map<string, number>();
  for (const fila of consumos) sumar(consumo, fila.product_id, num0(fila.cantidad));

  const lineas = productos.map((producto) => {
    const key = producto.id.toString();
    const aperturaBase = redondearCantidad(apertura.get(key) ?? 0);
    const comprasBase = redondearCantidad(compras.get(key) ?? 0);
    const ajustesBase = redondearCantidad(ajustes.get(key) ?? 0);
    const consumoBase = redondearCantidad(consumo.get(key) ?? 0);
    const esperadoBase = redondearCantidad(Math.max(0, aperturaBase + comprasBase + ajustesBase - consumoBase));
    const costo = costoUnitarioBase(producto);
    return {
      product_id: Number(producto.id),
      producto: producto.name,
      unidad_base: producto.unidad_base,
      unidad_operativa: unidadOperativaInventario(producto.unidad_base, producto.unidad_compra),
      apertura_base: aperturaBase,
      compras_base: comprasBase,
      ajustes_base: ajustesBase,
      consumo_teorico_base: consumoBase,
      esperado_base: esperadoBase,
      esperado_operativo: cantidadOperativaInventario({ totalBase: esperadoBase, unidadBase: producto.unidad_base, contenidoCompra: producto.contenido_compra == null ? null : num0(producto.contenido_compra) }),
      costo_unitario_base: costo,
      valor_esperado: costo == null ? null : redondearCantidad(esperadoBase * costo),
    } satisfies CierreInventarioPreviewLinea;
  }).filter((linea) => linea.apertura_base > 0 || linea.compras_base > 0 || linea.ajustes_base !== 0 || linea.consumo_teorico_base > 0);

  return {
    semana_id: Number(semanaId),
    apertura_snapshot_id: Number(ciclo.apertura_snapshot_id),
    cierre_snapshot_id: ciclo.cierre_snapshot_id == null ? null : Number(ciclo.cierre_snapshot_id),
    formula: 'apertura + compras + ajustes − consumo teórico',
    lineas,
    productos: lineas.length,
    consumo_teorico_base: redondearCantidad(lineas.reduce((suma, linea) => suma + linea.consumo_teorico_base, 0)),
    valor_esperado: redondearCantidad(lineas.reduce((suma, linea) => suma + (linea.valor_esperado ?? 0), 0)),
  };
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

  const resultado = await prisma.$transaction(async (tx) => {
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

  // Vincula el snapshot oficial al ciclo semanal en el mismo flujo que lo
  // capturó. Sin este paso la UI mostraba el conteo, pero el cierre seguía
  // considerándolo pendiente y la apertura siguiente no podía heredarlo.
  if (metadata.semana_id != null && (metadata.tipo === 'apertura' || metadata.tipo === 'cierre')) {
    const snapshotId = BigInt(resultado.snapshot_id);
    const valor = await valorSnapshot(negocioId, snapshotId);
    const data = metadata.tipo === 'apertura'
      ? { apertura_snapshot_id: snapshotId, apertura_valor: valor, apertura_origen: 'conteo_fisico_oficial' }
      : { cierre_snapshot_id: snapshotId, cierre_valor: valor };
    const actualizado = await prisma.inventario_semanal.updateMany({
      where: {
        negocio_id: negocioId,
        semana_id: BigInt(metadata.semana_id),
        ...(metadata.tipo === 'apertura' ? { apertura_snapshot_id: null } : { cierre_snapshot_id: null }),
      },
      data,
    });
    if (actualizado.count !== 1) {
      throw new HttpError(409, `La semana no tiene un ciclo de inventario disponible para vincular el ${metadata.tipo} oficial`);
    }
  }
  return resultado;
}
