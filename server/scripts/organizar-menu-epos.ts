/**
 * Organiza nombres y categorías visibles del Till de Ibérico.
 *
 * Dry-run por defecto. Usar --apply sólo después de revisar el plan.
 * Las claves se leen únicamente del entorno del proceso y nunca se guardan.
 */
import { prisma } from '../src/db.js';

const API_BASE = (process.env.EPOS_API_BASE_URL || 'https://api.eposnowhq.com/api/V2').replace(/\/+$/, '');
const KEY = process.env.EPOS_API_KEY || '';
const SECRET = process.env.EPOS_API_SECRET || '';
const APPLY = process.argv.includes('--apply');

type EposProduct = Record<string, any> & { ProductID: number; Name: string };
type EposCategory = Record<string, any> & { CategoryID: number; Name: string };
type EposCategoryV4 = Record<string, any> & { Id: number; Name: string };

const PRODUCT_NAMES: Record<number, { nombre: string; menuId?: number }> = {
  3273776: { nombre: 'Tequila 8 Botella', menuId: 173 },
  3036870: { nombre: '1800 Cristalino Botella', menuId: 174 },
  3036867: { nombre: 'Dobel Diamante Botella', menuId: 175 },
  2494673: { nombre: 'Hacienda de Tepa Botella', menuId: 176 },
  2313723: { nombre: 'Mezcal Tonic', menuId: 126 },
  2437871: { nombre: 'Chabela Vargas', menuId: 162 },
  3262857: { nombre: 'Clericot Chico', menuId: 163 },
  2523809: { nombre: 'Clericot Grande', menuId: 152 },
  3273927: { nombre: 'Cuba de Tequila 8', menuId: 160 },
};

/** Orden de navegación: alimentos → bebidas → botellas/servicios → sin alcohol. */
const CATEGORY_PLAN: Record<number, { nombre: string; sort: number }> = {
  176409: { nombre: 'Pizzas', sort: 10 },
  176407: { nombre: 'Tapas', sort: 20 },
  176408: { nombre: 'Tablas', sort: 30 },
  176374: { nombre: 'Papas y croquetas', sort: 40 },
  178203: { nombre: 'Cervezas', sort: 50 },
  176412: { nombre: 'Cócteles', sort: 60 },
  209508: { nombre: 'Gin', sort: 70 },
  209509: { nombre: 'Mezcal', sort: 80 },
  209510: { nombre: 'Spritz', sort: 90 },
  209511: { nombre: 'Café y cremosos', sort: 100 },
  209512: { nombre: 'Postres', sort: 110 },
  209507: { nombre: 'Vino por copa y espumosos', sort: 120 },
  178289: { nombre: 'Vino en botella', sort: 130 },
  180890: { nombre: 'Botellas y shots', sort: 140 },
  178204: { nombre: 'Bebidas sin alcohol', sort: 150 },
  228646: { nombre: 'Sushi', sort: 160 },
};

function apiUrl(path: string) {
  return `${API_BASE}/${path.replace(/^\//, '')}`;
}

async function api<T>(path: string, options: RequestInit = {}) {
  if (!KEY || !SECRET) throw new Error('Faltan EPOS_API_KEY/EPOS_API_SECRET');
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Epos ${response.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

async function apiV4<T>(path: string, options: RequestInit = {}) {
  if (!KEY || !SECRET) throw new Error('Faltan EPOS_API_KEY/EPOS_API_SECRET');
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const response = await fetch(`${API_BASE.replace(/\/V2$/i, '/v4')}/${path.replace(/^\//, '')}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Epos ${response.status} v4/${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

async function paginar<T>(recurso: string) {
  const all: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const rows = await api<T[]>(`${recurso}?page=${page}`);
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

async function main() {
  const [productos, categorias] = await Promise.all([
    paginar<EposProduct>('Product'),
    paginar<EposCategory>('Category'),
  ]);
  const productosPorId = new Map(productos.map((p) => [Number(p.ProductID), p]));
  const categoriasPorId = new Map(categorias.map((c) => [Number(c.CategoryID), c]));

  const nombres = Object.entries(PRODUCT_NAMES).flatMap(([id, plan]) => {
    const producto = productosPorId.get(Number(id));
    if (!producto) return [{ tipo: 'producto', id: Number(id), estado: 'id_no_encontrado', nombre: plan.nombre }];
    const changes = producto.Name === plan.nombre ? {} : { Name: plan.nombre };
    return [{ tipo: 'producto', id: Number(id), estado: 'plan', actual: producto.Name, propuesto: plan.nombre, changes, menuId: plan.menuId ?? null }];
  });

  const categoriasPlan = Object.entries(CATEGORY_PLAN).flatMap(([id, plan]) => {
    const categoria = categoriasPorId.get(Number(id));
    if (!categoria) return [{ tipo: 'categoria', id: Number(id), estado: 'id_no_encontrado', propuesto: plan.nombre }];
    const changes: Record<string, unknown> = {};
    if (categoria.Name !== plan.nombre) changes.Name = plan.nombre;
    if (Number(categoria.SortPosition ?? 0) !== plan.sort) changes.SortPosition = plan.sort;
    return [{ tipo: 'categoria', id: Number(id), estado: 'plan', actual: categoria.Name, propuesto: plan.nombre, sortActual: categoria.SortPosition ?? null, sortPropuesto: plan.sort, changes }];
  });

  const errores = [...nombres, ...categoriasPlan].filter((row) => row.estado === 'id_no_encontrado');
  const cambios = [...nombres, ...categoriasPlan].filter((row) => row.estado === 'plan' && Object.keys(row.changes ?? {}).length > 0);
  console.log(JSON.stringify({ modo: APPLY ? 'apply' : 'dry-run', productos_epos: productos.length, categorias_epos: categorias.length, cambios: cambios.length, errores, detalle: cambios }, null, 2));
  if (!APPLY) return;
  if (errores.length) throw new Error(`No se puede aplicar: ${errores.length} IDs no encontrados`);

  const resultados: { tipo: string; id: number; ok: boolean; error?: string }[] = [];
  for (const row of cambios) {
    try {
      if (row.tipo === 'producto') {
        const actual = productosPorId.get(row.id)!;
        await api(`Product/${row.id}`, { method: 'PUT', body: JSON.stringify({ ...actual, ...(row.changes ?? {}) }) });
        const plan = PRODUCT_NAMES[row.id];
        if (plan?.menuId != null) {
          await prisma.productos_menu.update({ where: { id: BigInt(plan.menuId) }, data: { nombre: plan.nombre } });
        }
      } else {
        // Las categorías heredadas devuelven 500 en V2. V4 requiere el objeto
        // completo dentro de un arreglo y conserva campos de impresión/Till.
        const actual = await apiV4<EposCategoryV4>(`Category/${row.id}`);
        const changes = row.changes as Record<string, unknown>;
        const body = {
          Id: actual.Id,
          ParentId: actual.ParentId ?? null,
          Name: changes.Name ?? actual.Name,
          // V4 exige una descripción de al menos un carácter; cuando Epos la
          // entrega vacía usamos el nombre visible para no dejar metadatos
          // inconsistentes.
          Description: typeof actual.Description === 'string' && actual.Description.trim().length > 0
            ? actual.Description
            : String(changes.Name ?? actual.Name),
          ImageUrl: actual.ImageUrl ?? '',
          PopupNoteId: actual.PopupNoteId ?? null,
          IsWet: actual.IsWet ?? false,
          ShowOnTill: actual.ShowOnTill ?? true,
          ReferenceCode: actual.ReferenceCode ?? null,
          SortPosition: changes.SortPosition ?? actual.SortPosition ?? null,
          ReportingCategoryId: actual.ReportingCategoryId ?? null,
          NominalCode: typeof actual.NominalCode === 'string' && actual.NominalCode.trim().length > 0
            ? actual.NominalCode
            : null,
          PrinterTypeId: actual.PrinterTypeId ?? null,
          CourseId: actual.CourseId ?? null,
          ButtonColourId: actual.ButtonColourId ?? null,
        };
        await apiV4('Category', { method: 'PUT', body: JSON.stringify([body]) });
      }
      resultados.push({ tipo: row.tipo, id: row.id, ok: true });
    } catch (error) {
      resultados.push({ tipo: row.tipo, id: row.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify({ resultados, actualizados: resultados.filter((r) => r.ok).length, errores: resultados.filter((r) => !r.ok).length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
