/**
 * Sincroniza cambios confirmados del catálogo local hacia Epos Now.
 *
 * Por seguridad es dry-run por defecto. Usar --apply sólo con credenciales
 * temporales en el entorno del proceso; nunca guardar las claves en el repo.
 * No modifica CategoryID ni SortPosition: el acomodo requiere una matriz
 * explícita de categorías/orden del Till.
 */
import { prisma } from '../src/db.js';
import { convertirCantidad, costoLinea } from '../src/recetas/costeo.js';
import { consumirFIFO } from '../src/inventario/fifo.js';
import { filtroConsumoFifoActivo } from '../src/inventario/fuentes.js';

const API_BASE = (process.env.EPOS_API_BASE_URL || 'https://api.eposnowhq.com/api/V2').replace(/\/+$/, '');
const KEY = process.env.EPOS_API_KEY || '';
const SECRET = process.env.EPOS_API_SECRET || '';
const APPLY = process.argv.includes('--apply');

type EposProduct = Record<string, any> & { ProductID: number; Name: string; SalePrice?: number; CostPrice?: number; SellOnTill?: boolean };

const ALIAS_EPOS: Record<string, string[]> = {
  'tequila 8 botella': ['tequila 8 botella', 'tequila 8', 'tequila ocho botella', 'tequila ocho', 'tequila ocho plata 750 ml', 'servicio tequila 8'],
  '1800 cristalino botella': ['1800 cristalino botella', '1800 cristalino', 'tequila 1800 cristalino 700 ml', 'tequila cuervo 1800 anejo cristalino 700 ml'],
  'dobel diamante botella': ['dobel diamante botella', 'dobel diamante', 'tequila dobel diamante', 'tequila dobel 750 ml', 'servicio maestro dobel'],
  'hacienda de tepa botella': ['hacienda de tepa botella', 'hacienda de tepa', 'tequila hacienda de tepa', 'tequila hacienda de tepa 750 ml', 'servicio de hacienda de tepa cristalino'],
};

function normalizarNombre(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function costRecipe(menu: any, lotesPorProducto: Map<string, any[]>, ultimoCostoPorProducto: Map<string, number>) {
  const recipe = menu.recetas[0];
  if (!recipe) return null;
  let total = 0;
  for (const line of recipe.lineas) {
    const cantidad = Number(line.cantidad);
    const cantidadBase = line.products.unidad_base ? convertirCantidad(cantidad, line.unidad, line.products.unidad_base) : null;
    const lotes = lotesPorProducto.get(line.product_id.toString()) ?? [];
    const toma = cantidadBase == null ? null : consumirFIFO(lotes, cantidadBase);
    if (toma && toma.faltante <= 0.0001) {
      total += toma.costoTotal;
      continue;
    }
    if (cantidadBase != null && ultimoCostoPorProducto.has(line.product_id.toString())) {
      total += cantidadBase * ultimoCostoPorProducto.get(line.product_id.toString())!;
      continue;
    }
    const result = costoLinea(cantidad, line.unidad, {
      unitCost: line.products.unit_cost == null ? null : Number(line.products.unit_cost),
      unidadBase: line.products.unidad_base,
      contenidoCompra: line.products.contenido_compra == null ? null : Number(line.products.contenido_compra),
      rendimientoUtil: line.products.rendimiento_util == null ? 1 : Number(line.products.rendimiento_util),
    });
    if (result.costoEstimado == null) return null;
    total += result.costoEstimado;
  }
  return Number(total.toFixed(2));
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!KEY || !SECRET) throw new Error('Faltan EPOS_API_KEY/EPOS_API_SECRET');
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const response = await fetch(`${API_BASE}/${path.replace(/^\//, '')}`, {
    ...options,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Epos ${response.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

async function main() {
  const epos: EposProduct[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const rows = await api<EposProduct[]>(`Product?page=${page}`);
    if (!rows.length) break;
    epos.push(...rows);
    if (rows.length < 200) break;
  }
  const byId = new Map(epos.map((product) => [Number(product.ProductID), product]));
  const menus = await prisma.productos_menu.findMany({
    where: { negocio_id: 1n, activo: true },
    select: {
      id: true, nombre: true, epos_product_id: true, precio_venta: true, activo: true,
      recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: { include: { products: { select: { unit_cost: true, unidad_base: true, contenido_compra: true, rendimiento_util: true } } } } } },
    },
  });
  const productIds = [...new Set(menus.flatMap((m) => m.recetas[0]?.lineas.map((l) => l.product_id) ?? []))];
  const [lotes, consumos] = productIds.length ? await Promise.all([
    prisma.inventory_lots.findMany({ where: { negocio_id: 1n, product_id: { in: productIds }, estado: 'abierto', cantidad_restante: { gt: 0 } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }], select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true } }),
    prisma.inventory_consumptions.findMany({ where: { negocio_id: 1n, product_id: { in: productIds }, ...filtroConsumoFifoActivo() }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], select: { product_id: true, costo_unitario: true } }),
  ]) : [[], []];
  const lotesPorProducto = new Map<string, any[]>();
  for (const lote of lotes) {
    const key = lote.product_id.toString();
    const rows = lotesPorProducto.get(key) ?? [];
    rows.push({ id: Number(lote.id), recibidoAt: lote.recibido_at.toISOString().slice(0, 10), cantidadRestante: Number(lote.cantidad_restante), costoUnitario: Number(lote.costo_unitario) });
    lotesPorProducto.set(key, rows);
  }
  const ultimoCostoPorProducto = new Map<string, number>();
  for (const consumo of consumos) if (!ultimoCostoPorProducto.has(consumo.product_id.toString())) ultimoCostoPorProducto.set(consumo.product_id.toString(), Number(consumo.costo_unitario));
  const byName = new Map<string, EposProduct[]>();
  for (const product of epos) {
    const key = normalizarNombre(String(product.Name ?? ''));
    const rows = byName.get(key) ?? [];
    rows.push(product);
    byName.set(key, rows);
  }
  const mapped = menus.map((menu) => {
    if (menu.epos_product_id != null) return { menu, current: byId.get(menu.epos_product_id) ?? null, propuesta: null as number | null };
    const aliases = ALIAS_EPOS[normalizarNombre(menu.nombre)] ?? [normalizarNombre(menu.nombre)];
    const candidates = [...new Map(aliases.flatMap((alias) => (byName.get(normalizarNombre(alias)) ?? []).map((item) => [Number(item.ProductID), item] as const))).values()];
    return { menu, current: candidates.length === 1 ? candidates[0] : null, propuesta: candidates.length === 1 ? Number(candidates[0].ProductID) : null };
  });
  const plans: { id: number; menuId: number; nombre: string; changes: Record<string, unknown>; body: EposProduct; linkEposProductId: number | null }[] = [];
  const unmappedLocal: string[] = [];
  const missing: string[] = [];
  for (const { menu, current, propuesta } of mapped) {
    const id = menu.epos_product_id ?? propuesta;
    if (id == null || !current) { unmappedLocal.push(menu.nombre); continue; }
    const changes: Record<string, unknown> = {};
    if (menu.precio_venta != null && Math.abs(Number(current.SalePrice ?? 0) - Number(menu.precio_venta)) > 0.005) changes.SalePrice = Number(menu.precio_venta);
    const cost = costRecipe(menu, lotesPorProducto, ultimoCostoPorProducto);
    if (cost != null && Math.abs(Number(current.CostPrice ?? 0) - cost) > 0.005) changes.CostPrice = cost;
    // Sólo ocultamos explícitamente productos retirados. Un producto activo
    // sin precio local todavía requiere confirmación antes de publicarse.
    if (!menu.activo && current.SellOnTill !== false) changes.SellOnTill = false;
    if (Object.keys(changes).length || propuesta != null) plans.push({ id, menuId: Number(menu.id), nombre: menu.nombre, changes, body: { ...current, ...changes }, linkEposProductId: propuesta });
  }
  for (const menu of menus.filter((item) => item.epos_product_id != null && !byId.has(item.epos_product_id!))) missing.push(`${menu.nombre} (${menu.epos_product_id})`);
  console.log(JSON.stringify({ modo: APPLY ? 'apply' : 'dry-run', productos_epos: epos.length, planes: plans.map(({ id, menuId, nombre, changes, linkEposProductId }) => ({ id, menuId, nombre, changes, linkEposProductId })), sin_mapeo_local: unmappedLocal, epos_id_inexistente: missing }, null, 2));
  if (!APPLY) return;
  const results: { id: number; nombre: string; ok: boolean; error?: string }[] = [];
  for (const plan of plans) {
    try {
      if (Object.keys(plan.changes).length) await api(`Product/${plan.id}`, { method: 'PUT', body: JSON.stringify(plan.body) });
      if (plan.linkEposProductId != null) await prisma.productos_menu.update({ where: { id: BigInt(plan.menuId) }, data: { epos_product_id: plan.linkEposProductId } });
      results.push({ id: plan.id, nombre: plan.nombre, ok: true });
    } catch (error) {
      results.push({ id: plan.id, nombre: plan.nombre, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify({ resultados: results, actualizados: results.filter((r) => r.ok).length, errores: results.filter((r) => !r.ok).length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
