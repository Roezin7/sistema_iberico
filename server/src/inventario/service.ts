import { prisma } from '../db.js';
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
  por_zona: { zona_id: number; zona: string; qty_captura: number; factor: number }[];
}

export interface InventarioActual {
  snapshot_id: number | null;
  fecha: string | null;
  productos: ProductoActual[];
  valor_total: number;
  sin_costo: { product_id: number; nombre: string }[];
}

/** Inventario "actual" = último snapshot del negocio, agregado por producto y zona. */
export async function inventarioActual(negocioId: bigint): Promise<InventarioActual> {
  const [productos, snap] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      include: { stores: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventory_snapshot.findFirst({
      where: { negocio_id: negocioId },
      orderBy: { id: 'desc' },
    }),
  ]);

  const lineas = snap
    ? await prisma.inventory_lines.findMany({
        where: { snapshot_id: snap.id },
        include: { zonas_inventario: true },
      })
    : [];

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
    const unitCost = num(p.unit_cost);
    if (unitCost == null) sinCosto.push({ product_id: Number(p.id), nombre: p.name });
    return {
      product_id: Number(p.id),
      nombre: p.name,
      store_id: Number(p.store_id),
      store: p.stores.name,
      base_qty: num0(p.base_qty),
      total_base: totalBase,
      unit_cost: unitCost,
      valor: valorProducto(totalBase, unitCost),
      por_zona: ls.map((l) => ({
        zona_id: Number(l.zona_id),
        zona: l.zonas_inventario.nombre,
        qty_captura: num0(l.qty_captura),
        factor: num0(l.factor),
      })),
    };
  });

  const valorTotal = Math.round(result.reduce((a, p) => a + p.valor, 0) * 100) / 100;

  return {
    snapshot_id: snap ? Number(snap.id) : null,
    fecha: snap ? snap.created_at.toISOString() : null,
    productos: result,
    valor_total: valorTotal,
    sin_costo: sinCosto,
  };
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
      valor_faltante: valorProducto(faltante, p.unit_cost),
    };
  });
  return armarListaCompras(faltantes);
}

export interface LineaConteoInput {
  product_id: number;
  zona_id: number;
  qty_captura: number;
}

/**
 * Crea un nuevo conteo (snapshot) con líneas por zona.
 * El factor se resuelve server-side desde product_zone_units (default 1) y se
 * "congela" en cada línea. Nunca sobrescribe snapshots previos (histórico).
 */
export async function crearConteo(negocioId: bigint, lineasInput: LineaConteoInput[]) {
  if (lineasInput.length === 0) {
    throw new HttpError(400, 'El conteo no tiene líneas');
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
    const snap = await tx.inventory_snapshot.create({ data: { negocio_id: negocioId } });
    await tx.inventory_lines.createMany({
      data: lineasInput.map((l) => ({
        snapshot_id: snap.id,
        product_id: BigInt(l.product_id),
        zona_id: BigInt(l.zona_id),
        qty_captura: l.qty_captura,
        factor: factorDe(l.product_id, l.zona_id),
      })),
    });
    return { snapshot_id: Number(snap.id), lineas: lineasInput.length };
  });
}
