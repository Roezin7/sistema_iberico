import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import {
  totalBaseProducto,
  faltanteCompra,
  valorProducto,
  armarListaCompras,
  type ProductoFaltante,
} from './logic.js';

export interface ProductoActual {
  product_id: number;
  nombre: string;
  store_id: number;
  store: string;
  base_qty: number;
  total_base: number;
  unit_cost: number | null;
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
  const costo = producto.unit_cost == null ? null : Number(producto.unit_cost);
  if (costo == null) return null;
  const contenido = producto.contenido_compra == null ? null : Number(producto.contenido_compra);
  if (producto.unidad_base && contenido != null && contenido > 0) return costo / contenido;
  return costo;
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
export async function inventarioActual(negocioId: bigint): Promise<InventarioActual> {
  const [productos, snaps] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      include: { stores: true, categorias_inventario: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory_snapshot.findMany({
      where: { negocio_id: negocioId },
      select: { id: true, created_at: true, tipo: true, semana_id: true },
    }),
  ]);

  const fechaPorSnap = new Map(snaps.map((s) => [s.id.toString(), s.created_at]));
  const metadataPorSnap = new Map(snaps.map((s) => [s.id.toString(), { tipo: s.tipo, semana_id: s.semana_id }]));
  const snapIds = snaps.map((s) => s.id);

  // Por cada zona, el snapshot más reciente que la haya contado.
  const ultimoPorZona = snapIds.length
    ? await prisma.inventory_lines.groupBy({
        by: ['zona_id'],
        where: { snapshot_id: { in: snapIds } },
        _max: { snapshot_id: true },
      })
    : [];

  const pares = ultimoPorZona
    .map((g) => ({ zona_id: g.zona_id, snapshot_id: g._max.snapshot_id }))
    .filter((p): p is { zona_id: bigint; snapshot_id: bigint } => p.snapshot_id != null);

  // Líneas vigentes = las del último conteo de cada zona.
  const lineas = pares.length
    ? await prisma.inventory_lines.findMany({
        where: { OR: pares.map((p) => ({ snapshot_id: p.snapshot_id, zona_id: p.zona_id })) },
        include: { zonas_inventario: true },
      })
    : [];

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
    if (unitCostPresentation == null) sinCosto.push({ product_id: Number(p.id), nombre: p.name });
    return {
      product_id: Number(p.id),
      nombre: p.name,
      store_id: Number(p.store_id),
      store: p.stores.name,
      base_qty: num0(p.base_qty),
      total_base: totalBase,
      // Se conserva unit_cost como costo de compra para la UI; la valuación
      // usa explícitamente el costo por unidad base.
      unit_cost: unitCostPresentation,
      valor: valorProducto(totalBase, unitCostBase),
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

  return {
    snapshot_id: snapIdActual != null ? Number(snapIdActual) : null,
    fecha: fechaActual ? fechaActual.toISOString() : null,
    tipo: snapIdActual != null ? metadataPorSnap.get(snapIdActual.toString())?.tipo ?? null : null,
    semana_id: snapIdActual != null && metadataPorSnap.get(snapIdActual.toString())?.semana_id != null
      ? Number(metadataPorSnap.get(snapIdActual.toString())!.semana_id)
      : null,
    productos: result,
    valor_total: valorTotal,
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

/** Lista de compras: faltantes (base_qty - total_base) agrupados por tienda. */
export async function listaCompras(negocioId: bigint) {
  const actual = await inventarioActual(negocioId);
  const faltantes: ProductoFaltante[] = actual.productos.map((p) => {
    const faltante = faltanteCompra(p.base_qty, p.total_base);
    return {
      product_id: p.product_id,
      nombre: p.nombre,
      store_id: p.store_id,
      store: p.store,
      base_qty: p.base_qty,
      total_base: p.total_base,
      faltante,
      unit_cost: p.unit_cost,
      valor_faltante: valorProducto(faltante, costoUnitarioBase(p)),
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
    prisma.products.findMany({ where: { id: { in: productIds }, negocio_id: negocioId }, select: { id: true } }),
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

  return prisma.$transaction(async (tx) => {
    // Una semana sólo puede tener una apertura y un cierre oficiales. Si el
    // usuario necesita corregirlos, debe usar un ajuste documentado; de esa
    // forma nunca queda ambiguo qué conteo alimenta el FIFO de la semana.
    if (metadata.semana_id != null && (metadata.tipo === 'apertura' || metadata.tipo === 'cierre')) {
      const semanal = await tx.inventario_semanal.findUnique({
        where: { semana_id: BigInt(metadata.semana_id) },
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
      data: lineasInput.map((l) => ({
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
