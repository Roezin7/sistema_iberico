/**
 * Mapea las cuatro botellas de la carta 2026 al catálogo de inventario.
 *
 * Crea/actualiza el producto de menú, agrega una receta validada de botella
 * completa y deja alias de búsqueda sobre el insumo físico. No inventa un
 * ProductID de Epos: ese enlace se completa cuando se confirme el producto
 * remoto correspondiente.
 *
 * Uso:
 *   tsx scripts/mapear-botellas-menu-2026.ts
 *   tsx scripts/mapear-botellas-menu-2026.ts --apply
 */
import { prisma } from '../src/db.js';

const NEGOCIO_ID = 1n;
const APPLY = process.argv.includes('--apply');

type Bottle = {
  menu: string;
  price: number;
  inventoryName: string;
  quantity: number;
  unit: 'pieza' | 'ml';
  volume: number;
  alias: string;
  note: string;
  updatePresentation?: { contenido_compra: number; unidad_compra: string };
};

const BOTTLES: Bottle[] = [
  {
    menu: 'Tequila 8 Botella', price: 1750, inventoryName: 'Tequila Ocho', quantity: 1, unit: 'pieza', volume: 750,
    alias: 'tequila 8 botella 750 ml', note: 'Botella completa de Tequila 8 / Tequila Ocho (750 ml). El inventario histórico se controla en piezas para no reescalar conteos anteriores.',
    updatePresentation: { contenido_compra: 1, unidad_compra: 'botella' },
  },
  {
    menu: '1800 Cristalino Botella', price: 1950, inventoryName: '1800 Cristalino', quantity: 700, unit: 'ml', volume: 700,
    alias: '1800 cristalino botella 700 ml', note: 'Botella completa de 1800 Cristalino (700 ml).',
  },
  {
    menu: 'Dobel Diamante Botella', price: 1750, inventoryName: 'Tequila Dobel', quantity: 750, unit: 'ml', volume: 750,
    alias: 'dobel diamante botella 750 ml', note: 'Botella completa de Dobel Diamante (750 ml).',
    updatePresentation: { contenido_compra: 750, unidad_compra: 'botella' },
  },
  {
    menu: 'Hacienda de Tepa Botella', price: 900, inventoryName: 'Hacienda de Tepa', quantity: 750, unit: 'ml', volume: 750,
    alias: 'hacienda de tepa botella 750 ml', note: 'Botella completa de Hacienda de Tepa (750 ml).',
    updatePresentation: { contenido_compra: 750, unidad_compra: 'botella' },
  },
];

function serializar(value: unknown) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? Number(item) : item, 2);
}

async function main() {
  if (!APPLY) {
    const preview: any[] = [];
    for (const bottle of BOTTLES) {
      const product = await prisma.products.findFirst({ where: { negocio_id: NEGOCIO_ID, name: bottle.inventoryName }, select: { id: true, name: true, unidad_base: true, contenido_compra: true, unidad_compra: true } });
      const menu = await prisma.productos_menu.findFirst({ where: { negocio_id: NEGOCIO_ID, nombre: bottle.menu }, select: { id: true, precio_venta: true, epos_product_id: true, activo: true } });
      const recipe = menu ? await prisma.recetas.findFirst({ where: { producto_menu_id: menu.id, estado: 'validada' }, orderBy: { version: 'desc' }, select: { id: true, version: true } }) : null;
      preview.push({ menu: bottle.menu, precio: bottle.price, inventory_product_id: product?.id ?? null, inventory_product: product?.name ?? null, unidad_inventario: product?.unidad_base ?? null, contenido_actual: product?.contenido_compra ?? null, menu_id: menu?.id ?? null, precio_actual: menu?.precio_venta ?? null, epos_product_id: menu?.epos_product_id ?? null, receta_validada: recipe ? { id: recipe.id, version: recipe.version } : null });
    }
    console.log(serializar({ modo: 'dry-run', botellas: preview }));
    return;
  }
  const result = await prisma.$transaction(async (tx) => {
    const output: any[] = [];
    for (const bottle of BOTTLES) {
      const product = await tx.products.findFirst({ where: { negocio_id: NEGOCIO_ID, name: bottle.inventoryName }, select: { id: true, name: true, unidad_base: true, contenido_compra: true, unidad_compra: true } });
      if (!product) throw new Error(`No existe el insumo de inventario: ${bottle.inventoryName}`);
      if (product.unidad_base !== bottle.unit && !(bottle.inventoryName === 'Tequila Ocho' && product.unidad_base === 'pieza')) {
        throw new Error(`Unidad incompatible para ${bottle.inventoryName}: ${product.unidad_base ?? 'sin unidad'}; se esperaba ${bottle.unit}`);
      }

      const menuActual = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO_ID, nombre: bottle.menu }, select: { id: true, precio_venta: true, epos_product_id: true, activo: true } });
      const menu = menuActual
        ? await tx.productos_menu.update({ where: { id: menuActual.id }, data: { precio_venta: bottle.price, activo: true } })
        : await tx.productos_menu.create({ data: { negocio_id: NEGOCIO_ID, nombre: bottle.menu, precio_venta: bottle.price, activo: true } });

      const recipe = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id, estado: 'validada' }, orderBy: { version: 'desc' }, select: { id: true, version: true } });
      let recipeId = recipe?.id ?? null;
      let recipeVersion = recipe?.version ?? null;
      if (!recipe) {
        const latest = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.recetas.create({ data: {
          producto_menu_id: menu.id,
          version: (latest?.version ?? 0) + 1,
          estado: 'validada',
          fuente: 'IBÉRICO MENU 2026 · mapeo de botellas',
          notas: bottle.note,
          vigente_desde: new Date('2026-10-01'),
          lineas: { create: [{ product_id: product.id, cantidad: bottle.quantity, unidad: bottle.unit, nota: bottle.note }] },
        }, select: { id: true, version: true } });
        recipeId = created.id;
        recipeVersion = created.version;
      }

      await tx.product_aliases.upsert({ where: { alias: bottle.alias }, update: { product_id: product.id }, create: { product_id: product.id, alias: bottle.alias } });
      if (bottle.updatePresentation) {
        await tx.products.update({ where: { id: product.id }, data: bottle.updatePresentation });
      }
      output.push({ menu_id: menu.id, menu: bottle.menu, precio: bottle.price, inventory_product_id: product.id, inventory_product: product.name, volumen_ml: bottle.volume, unidad_receta: bottle.unit, cantidad_receta: bottle.quantity, recipe_id: recipeId, recipe_version: recipeVersion, epos_product_id: menu.epos_product_id ?? null });
    }
    return output;
  }, { maxWait: 60000, timeout: 120000 });

  console.log(serializar({ modo: 'apply', botellas: result }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
