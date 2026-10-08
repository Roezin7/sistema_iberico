/**
 * Crea y conecta los productos confirmados del menú 2026 que faltaban:
 * Pizza Canaria, Pizza Gallega y Azulito Grande.
 *
 * Dry-run por defecto. Las claves de Epos sólo se leen del entorno del proceso.
 * Usar --apply para aplicar cambios locales y remotos.
 */
import { prisma } from '../src/db.js';

const NEGOCIO_ID = 1n;
const APPLY = process.argv.includes('--apply');
const API_BASE = (process.env.EPOS_API_BASE_URL || 'https://api.eposnowhq.com/api/V2').replace(/\/+$/, '');
const KEY = process.env.EPOS_API_KEY || '';
const SECRET = process.env.EPOS_API_SECRET || '';

type EposProduct = Record<string, any> & { ProductID: number; Name: string; CostPrice?: number; SalePrice?: number; CategoryID?: number | null };

type Linea = { producto: string; cantidad: number; unidad: string };
type ProductoPlan = {
  nombre: string;
  precio: number;
  categoriaEpos: number;
  color: number;
  descripcion: string;
  eposProductId?: number;
  lineas: Linea[];
};

const PLAN: ProductoPlan[] = [
  {
    nombre: 'Pizza Canaria', precio: 115, categoriaEpos: 176409, color: 10,
    descripcion: 'Mozzarella, salchichón y piña.',
    lineas: [
      { producto: 'Harina', cantidad: 160, unidad: 'g' },
      { producto: 'Agua natural', cantidad: 100, unidad: 'ml' },
      { producto: 'Prego', cantidad: 50, unidad: 'g' },
      { producto: 'Salchichon', cantidad: 50, unidad: 'g' },
      { producto: 'Piña', cantidad: 50, unidad: 'g' },
      { producto: 'Mozzarella', cantidad: 40, unidad: 'g' },
    ],
  },
  {
    nombre: 'Pizza Gallega', precio: 135, categoriaEpos: 176409, color: 10,
    descripcion: 'Mozzarella, nuez de la India y chicharrón de habanero.',
    lineas: [
      { producto: 'Harina', cantidad: 160, unidad: 'g' },
      { producto: 'Agua natural', cantidad: 100, unidad: 'ml' },
      { producto: 'Prego', cantidad: 50, unidad: 'g' },
      { producto: 'Nuez de la India', cantidad: 30, unidad: 'g' },
      { producto: 'Chicharrón de habanero', cantidad: 10, unidad: 'g' },
      { producto: 'Mozzarella', cantidad: 40, unidad: 'g' },
    ],
  },
  {
    nombre: 'Azulito Grande', precio: 100, categoriaEpos: 176412, color: 6,
    eposProductId: 2313880,
    descripcion: 'Arriero, agua mineral y Volt.',
    lineas: [
      { producto: 'Arriero', cantidad: 4, unidad: 'oz' },
      { producto: 'Agua Mineral', cantidad: 300, unidad: 'ml' },
      { producto: 'Volt', cantidad: 300, unidad: 'ml' },
    ],
  },
];

function normalizar(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!KEY || !SECRET) throw new Error('Faltan EPOS_API_KEY/EPOS_API_SECRET');
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const response = await fetch(`${API_BASE}/${path.replace(/^\//, '')}`, {
    ...options,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Epos ${response.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

async function cargarProductosEpos() {
  const all: EposProduct[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const rows = await api<EposProduct[]>(`Product?page=${page}`);
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

function costoBase(productos: Map<string, any>, plan: ProductoPlan) {
  let total = 0;
  const pendientes: string[] = [];
  for (const linea of plan.lineas) {
    const producto = productos.get(normalizar(linea.producto));
    if (!producto || producto.unidad_base == null || producto.contenido_compra == null || producto.unit_cost == null) {
      pendientes.push(linea.producto);
      continue;
    }
    const cantidadBase = linea.unidad === producto.unidad_base
      ? linea.cantidad
      : linea.unidad === 'oz' && producto.unidad_base === 'ml'
        ? linea.cantidad * 29.5735295625
        : null;
    if (cantidadBase == null) {
      pendientes.push(`${linea.producto} (${linea.unidad} → ${producto.unidad_base})`);
      continue;
    }
    total += cantidadBase * Number(producto.unit_cost) / Number(producto.contenido_compra) / Number(producto.rendimiento_util ?? 1);
  }
  return { costo: Number(total.toFixed(2)), pendientes };
}

async function main() {
  const store = await prisma.stores.findFirst({ where: { negocio_id: NEGOCIO_ID }, select: { id: true } });
  if (!store) throw new Error('No hay una tienda configurada para el negocio');

  const inventoryNames = [...new Set(PLAN.flatMap((p) => p.lineas.map((l) => l.producto)))];
  const existingProducts = await prisma.products.findMany({ where: { negocio_id: NEGOCIO_ID, name: { in: inventoryNames } } });
  const byName = new Map(existingProducts.map((p) => [normalizar(p.name), p]));
  const missingInventory = inventoryNames.filter((name) => !byName.has(normalizar(name)));

  const eposProducts = await cargarProductosEpos();
  const eposByName = new Map(eposProducts.map((p) => [normalizar(p.Name), p]));
  const remotePlans = PLAN.map((plan) => {
    const current = plan.eposProductId != null
      ? eposProducts.find((p) => Number(p.ProductID) === plan.eposProductId) ?? null
      : eposByName.get(normalizar(plan.nombre)) ?? null;
    const cost = costoBase(byName, plan);
    return { plan, current, cost };
  });

  const preview = remotePlans.map(({ plan, current, cost }) => ({
    nombre: plan.nombre, precio: plan.precio, epos_actual: current ? { id: current.ProductID, nombre: current.Name, precio: current.SalePrice, costo: current.CostPrice } : null,
    costo_calculado: cost.costo, costo_pendiente: cost.pendientes,
    inventario_faltante: missingInventory.filter((name) => plan.lineas.some((l) => l.producto === name)),
  }));
  console.log(JSON.stringify({ modo: APPLY ? 'apply' : 'dry-run', preview }, null, 2));
  if (!APPLY) return;

  // Los ingredientes nuevos se crean sin costo: se completarán cuando llegue
  // su primera compra. No se inventa precio de adquisición.
  for (const name of missingInventory) {
    const created = await prisma.products.create({
      data: {
        negocio_id: NEGOCIO_ID, name, store_id: store.id, base_qty: 0, active: true,
        unit_cost: null, unidad_base: 'g', contenido_compra: null, unidad_compra: null, rendimiento_util: 1,
      },
    });
    byName.set(normalizar(created.name), created);
  }

  const results: any[] = [];
  for (const { plan, current, cost } of remotePlans) {
    let remote = current;
    if (!remote) {
      remote = await api<EposProduct>('Product', {
        method: 'POST',
        body: JSON.stringify({
          Name: plan.nombre, Description: plan.descripcion, CostPrice: cost.costo,
          SalePrice: plan.precio, EatOutPrice: 0, CategoryID: plan.categoriaEpos,
          Barcode: null, TaxRateID: null, EatOutTaxRateID: null, CostPriceTaxRateID: null,
          BrandID: null, SupplierID: null, PopupNoteID: null, UnitOfSale: null,
          VolumeOfSale: null, MultiChoiceID: null, ColourID: null, VariantGroupID: null,
          Size: null, Sku: null, SellOnWeb: false, SellOnTill: true, OrderCode: null,
          ButtonColourID: plan.color, SortPosition: null, RRPrice: null, ProductType: 0,
          TareWeight: null, ArticleCode: null,
        }),
      });
    } else {
      const body = { ...remote, Name: plan.nombre, Description: plan.descripcion, SalePrice: plan.precio, CategoryID: plan.categoriaEpos, SellOnTill: true, ButtonColourID: plan.color };
      // Sólo actualizamos costo remoto si todas las líneas ya tienen costo.
      if (cost.pendientes.length === 0) body.CostPrice = cost.costo;
      await api(`Product/${remote.ProductID}`, { method: 'PUT', body: JSON.stringify(body) });
      remote = { ...remote, ...body };
    }

    const menu = await prisma.productos_menu.upsert({
      where: { negocio_id_nombre: { negocio_id: NEGOCIO_ID, nombre: plan.nombre } },
      create: { negocio_id: NEGOCIO_ID, nombre: plan.nombre, epos_product_id: Number(remote.ProductID), precio_venta: plan.precio, activo: true },
      update: { epos_product_id: Number(remote.ProductID), precio_venta: plan.precio, activo: true },
    });
    const latest = await prisma.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    if (!latest) {
      await prisma.recetas.create({
        data: {
          producto_menu_id: menu.id, version: 1, estado: 'validada', fuente: 'Receta confirmada por el usuario; menú 2026',
          notas: cost.pendientes.length ? `Costo pendiente de compra para: ${cost.pendientes.join(', ')}.` : null,
          lineas: { create: plan.lineas.map((linea) => ({ product_id: byName.get(normalizar(linea.producto))!.id, cantidad: linea.cantidad, unidad: linea.unidad })) },
        },
      });
    }
    results.push({ nombre: plan.nombre, epos_product_id: Number(remote.ProductID), precio: plan.precio, costo_fifo_configurado: cost.pendientes.length === 0, pendientes: cost.pendientes });
  }
  console.log(JSON.stringify({ aplicados: results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
