import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const VIGENTE_DESDE = new Date('2026-09-12T00:00:00.000Z');
const MARCA = 'RUTA-BEBIDAS-CORREGIDA-2026-09-12';
const FUENTE = 'Hoja de ruta bebidas · actualización operativa 2026-09-12';
const out = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

const recipes = {
  'Perla Negra': (ids) => [
    ['Jagger', 2, 'oz'], ['Volt', 200, 'ml'],
  ],
  'Paloma Chica': (ids) => [
    ['Hacienda de Tepa', 2, 'oz'], ['Limón', 2, 'pieza'],
    ['Squirt', 100, 'ml'], ['Sprite', 100, 'ml'],
  ],
  'Paloma Grande': (ids) => [
    ['Hacienda de Tepa', 4, 'oz'], ['Limón', 4, 'pieza'],
    ['Squirt', 200, 'ml'], ['Sprite', 200, 'ml'],
  ],
  'Paloma Grande Dobel': (ids) => [
    ['Tequila Dobel', 4, 'oz'], ['Limón', 4, 'pieza'],
    ['Squirt', 200, 'ml'], ['Sprite', 200, 'ml'],
  ],
  'Vampiro Chico': (ids) => [
    ['Hacienda de Tepa', 2, 'oz'], ['Viuda de Sánchez', 1, 'oz'],
    ['Squirt', 200, 'ml'], ['Limón', 0.5, 'pieza'],
  ],
  'Vampiro Grande': (ids) => [
    ['Hacienda de Tepa', 4, 'oz'], ['Viuda de Sánchez', 1, 'oz'],
    ['Squirt', 200, 'ml'], ['Limón', 1, 'pieza'],
  ],
  'Limonada': (ids) => [
    ['Limón', 2, 'pieza'], ['Madrileña', 1, 'oz'],
    ['Sprite', 100, 'ml'], ['Agua Mineral', 200, 'ml'],
  ],
  'Piñada': (ids) => [
    ['Jugo de Piña', 200, 'ml'], ['Calahua', 4, 'oz'],
    ['Piña', 60, 'g'], ['Madrileña', 1, 'oz'],
  ],
  'Coco Spritz': (ids) => [
    ['Absolut 750 ml', 2, 'oz'], ['Aperol', 1, 'oz'],
    ['Madrileña', 1, 'oz'], ['Calahua', 90, 'ml'], ['Limón', 0.5, 'pieza'],
  ],
};

const notes = {
  'Perla Negra': 'Volt confirmado; se elimina Sprite.',
  'Paloma Chica': 'Squirt y Sprite en partes iguales; 200 ml totales.',
  'Paloma Grande': 'Squirt y Sprite en partes iguales; 400 ml totales.',
  'Paloma Grande Dobel': 'Squirt y Sprite en partes iguales; 400 ml totales.',
  'Vampiro Chico': 'Se agrega 1/2 pieza de Limón.',
  'Vampiro Grande': 'Tequila Hacienda de Tepa a 4 oz y 1 pieza de Limón.',
  'Limonada': '100 ml Sprite y 200 ml Agua Mineral.',
  'Piñada': 'Se agrega 1 oz de endulzante (Madrileña).',
  'Coco Spritz': 'Aperol ajustado a 1 oz.',
};

const result = await prisma.$transaction(async (tx) => {
  const products = await tx.products.findMany({
    where: { negocio_id: NEGOCIO },
    select: { id: true, name: true },
  });
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const productId = (name) => {
    const product = byName.get(name.toLowerCase());
    if (!product) throw new Error(`Producto no encontrado: ${name}`);
    return product.id;
  };

  const updated = [];
  for (const [menuName, build] of Object.entries(recipes)) {
    const menu = await tx.productos_menu.findFirst({
      where: { negocio_id: NEGOCIO, nombre: menuName, activo: true },
      include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!menu) throw new Error(`Menú no encontrado: ${menuName}`);
    const latest = menu.recetas[0];
    if (latest?.fuente === FUENTE && (latest.notas ?? '').includes(MARCA)) {
      updated.push({ menu: menuName, status: 'ya_aplicada', receta: latest.id, version: latest.version });
      continue;
    }
    const lineas = build({}).map(([name, cantidad, unidad]) => ({
      product_id: productId(name), cantidad, unidad,
    }));
    const max = await tx.recetas.findFirst({
      where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true },
    });
    const receta = await tx.recetas.create({
      data: {
        producto_menu_id: menu.id,
        version: (max?.version ?? 0) + 1,
        estado: 'validada',
        fuente: FUENTE,
        notas: `${MARCA}. ${notes[menuName]}`,
        vigente_desde: VIGENTE_DESDE,
        lineas: { create: lineas },
      },
      include: { lineas: true },
    });
    updated.push({ menu: menuName, status: 'creada', receta: receta.id, version: receta.version, lineas: receta.lineas.length });
  }
  return updated;
}, { maxWait: 60000, timeout: 120000 });

console.log(out({ ok: true, vigente_desde: VIGENTE_DESDE, updated: result }));
await prisma.$disconnect();
