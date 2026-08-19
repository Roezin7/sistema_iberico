import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;

type Meta = {
  nombre: string;
  costo?: number;
  unidad_base: 'g' | 'ml' | 'pieza' | 'unidad';
  contenido_compra: number;
  unidad_compra: string;
  rendimiento_util?: number;
};

// Sólo se incluyen presentaciones confirmadas en la conversación. El costo
// sigue siendo el último costo de catálogo hasta que el módulo FIFO lo
// sustituya por el costo del lote consumido.
const metadata: Meta[] = [
  { nombre: 'Absolut 750 ml', unidad_base: 'ml', contenido_compra: 750, unidad_compra: 'botella' },
  { nombre: '400 Conejos 700 ml', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Vino tinto', unidad_base: 'ml', contenido_compra: 750, unidad_compra: 'botella' },
  { nombre: 'Tinto California', costo: 81, unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella' },
  { nombre: 'Bacardi', unidad_base: 'ml', contenido_compra: 750, unidad_compra: 'botella' },
  { nombre: 'Licor 43', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Vermouth Rojo', costo: 305, unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Campari', costo: 475, unidad_base: 'ml', contenido_compra: 750, unidad_compra: 'botella' },
  { nombre: 'Aperol', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Prosseco', unidad_base: 'ml', contenido_compra: 750, unidad_compra: 'botella' },
  { nombre: 'Arriero', unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella' },
  { nombre: 'Ginebra Gibsons', costo: 200, unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Hacienda de Tepa', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Jagger', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Madrileña', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Sprite', unidad_base: 'ml', contenido_compra: 2000, unidad_compra: 'botella' },
  { nombre: 'Squirt', unidad_base: 'ml', contenido_compra: 2000, unidad_compra: 'botella' },
  { nombre: 'Agua Mineral', unidad_base: 'ml', contenido_compra: 2000, unidad_compra: 'botella' },
  { nombre: 'Ginger', costo: 25, unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella' },
  { nombre: 'Jugo de Mango', costo: 58, unidad_base: 'ml', contenido_compra: 1900, unidad_compra: 'botella' },
  { nombre: 'Jugo de Piña', costo: 58, unidad_base: 'ml', contenido_compra: 1900, unidad_compra: 'botella' },
  { nombre: 'Jugo de Naranja', costo: 58, unidad_base: 'ml', contenido_compra: 1900, unidad_compra: 'botella' },
  { nombre: 'Tonica', unidad_base: 'ml', contenido_compra: 2000, unidad_compra: 'botella' },
  { nombre: 'Calahua', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Corona', unidad_base: 'pieza', contenido_compra: 1, unidad_compra: 'pieza' },
  { nombre: 'Victoria', unidad_base: 'pieza', contenido_compra: 1, unidad_compra: 'pieza' },
  { nombre: 'Modelo', unidad_base: 'pieza', contenido_compra: 1, unidad_compra: 'pieza' },
  { nombre: 'Stella', unidad_base: 'pieza', contenido_compra: 1, unidad_compra: 'pieza' },
  { nombre: 'Ultra', unidad_base: 'pieza', contenido_compra: 1, unidad_compra: 'pieza' },
  { nombre: 'Frutos rojos', costo: 254, unidad_base: 'g', contenido_compra: 1810, unidad_compra: 'bolsa congelada' },
  { nombre: 'Jamon Serrano', costo: 199, unidad_base: 'g', contenido_compra: 340, unidad_compra: 'paquete' },
  { nombre: 'Salchichon', unidad_base: 'g', contenido_compra: 500, unidad_compra: 'pieza' },
  { nombre: 'Chorizo', unidad_base: 'g', contenido_compra: 500, unidad_compra: 'pieza' },
  { nombre: 'Pan', costo: 27.5, unidad_base: 'g', contenido_compra: 200, unidad_compra: 'pieza' },
  { nombre: 'Romero', unidad_base: 'pieza', contenido_compra: 20, unidad_compra: 'ramas útiles' },
  { nombre: 'Mozzarella', costo: 75, unidad_base: 'g', contenido_compra: 500, unidad_compra: 'bolsa' },
  { nombre: 'Queso crema', costo: 89, unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'envase' },
  { nombre: 'Manchego', costo: 75, unidad_base: 'g', contenido_compra: 500, unidad_compra: 'bloque' },
  { nombre: 'Fresas', unidad_base: 'g', contenido_compra: 1810, unidad_compra: 'bolsa congelada' },
  { nombre: 'Prego', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'envase' },
  { nombre: 'Harina', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'bolsa' },
  { nombre: 'Nieve', costo: 189, unidad_base: 'g', contenido_compra: 3400, unidad_compra: 'bote' },
  { nombre: 'Papas a la francesa', costo: 649, unidad_base: 'g', contenido_compra: 13600, unidad_compra: 'caja' },
  { nombre: 'Tocino', costo: 183.11, unidad_base: 'g', contenido_compra: 567, unidad_compra: 'bolsa' },
  { nombre: 'Ketchup', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'envase' },
  { nombre: 'Vinagre balsamico', unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella' },
  { nombre: 'Café espresso', costo: 163, unidad_base: 'g', contenido_compra: 340, unidad_compra: 'bolsa' },
  { nombre: 'Mermelada', costo: 201.51, unidad_base: 'g', contenido_compra: 1200, unidad_compra: 'lote interno' },
  { nombre: 'Queso amarillo', costo: 255, unidad_base: 'g', contenido_compra: 3000, unidad_compra: 'bote' },
  { nombre: 'Fanta Roja', unidad_base: 'ml', contenido_compra: 2000, unidad_compra: 'botella' },
  { nombre: 'Limón', unidad_base: 'pieza', contenido_compra: 14, unidad_compra: 'kg' },
  { nombre: 'Agua natural', unidad_base: 'ml', contenido_compra: 5000, unidad_compra: 'garrafón' },
  { nombre: 'Miel Carlota', unidad_base: 'g', contenido_compra: 300, unidad_compra: 'envase' },
  { nombre: 'Pepino', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'kg' },
  { nombre: 'Perejil', unidad_base: 'pieza', contenido_compra: 50, unidad_compra: 'manojo' },
  { nombre: 'Hierba buena', unidad_base: 'g', contenido_compra: 30, unidad_compra: 'manojo' },
  { nombre: 'Lechera', unidad_base: 'ml', contenido_compra: 257.95, unidad_compra: 'lata 335g' },
  { nombre: 'Carnation', unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'litro' },
  { nombre: 'Frutos secos', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'kg' },
  { nombre: 'Naranja', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'kg' },
  { nombre: 'Saborizante Jamaica', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Concentrado de horchata', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Piña', unidad_base: 'g', contenido_compra: 1000, unidad_compra: 'kg' },
  { nombre: 'Saborizante tamarindo', unidad_base: 'ml', contenido_compra: 700, unidad_compra: 'botella' },
  { nombre: 'Cebolla', unidad_base: 'g', contenido_compra: 400, unidad_compra: '2 piezas' },
  { nombre: 'Azúcar morena', unidad_base: 'g', contenido_compra: 2000, unidad_compra: 'bolsa' },
];

type Linea = [string, number, string, string?];
const recipes: Record<string, Linea[]> = {
  'Copa de la Casa': [['Vino tinto', 177.44, 'ml', 'estándar provisional de copa de 6 oz']],
  'Papas a la francesa': [['Papas a la francesa', 150, 'g'], ['Ketchup', 40, 'g']],
  'Vampiro Grande': [['Viuda de Sánchez', 29.57, 'ml'], ['Hacienda de Tepa', 59.15, 'ml'], ['Squirt', 200, 'ml']],
  'Cuba/Shot Jagger': [['Jagger', 59.15, 'ml']],
  'Paloma Grande': [['Limón', 4, 'pieza'], ['Hacienda de Tepa', 118.29, 'ml'], ['Squirt', 400, 'ml']],
  'Cuba de hacienda de tepa': [['Hacienda de Tepa', 59.15, 'ml'], ['Squirt', 250, 'ml']],
  'Michelob Ultra': [['Ultra', 1, 'pieza']],
  'Piñada': [['Calahua', 118.29, 'ml'], ['Piña', 60, 'g'], ['Jugo de Piña', 200, 'ml']],
  'Limonada': [['Limón', 2, 'pieza'], ['Madrileña', 29.57, 'ml'], ['Sprite', 200, 'ml'], ['Agua natural', 100, 'ml', 'agua/hielo de servicio']],
  'Papas Ibéricas': [['Papas a la francesa', 150, 'g'], ['Tocino', 40, 'g'], ['Queso amarillo', 50, 'g']],
  'Michelada Chica': [['Michemix', 60, 'ml'], ['Corona', 1, 'pieza', 'alternativa operativa: Victoria']],
  'Mezcalita Piña': [['400 Conejos 700 ml', 59.15, 'ml'], ['Madrileña', 29.57, 'ml'], ['Limón', 1.5, 'pieza'], ['Jugo de Piña', 100, 'ml'], ['Squirt', 60, 'ml']],
  'Pizza Ibérica': [['Harina', 160, 'g'], ['Agua natural', 100, 'ml'], ['Prego', 50, 'g'], ['Mozzarella', 40, 'g'], ['Jamon Serrano', 30, 'g'], ['Vinagre balsamico', 30, 'ml']],
  'Raspberry Spritz': [['Aperol', 60, 'ml'], ['Prosseco', 90, 'ml'], ['Agua Mineral', 30, 'ml'], ['Frutos rojos', 20, 'g']],
  Carajillo: [['Café espresso', 5, 'g'], ['Licor 43', 59.15, 'ml']],
  'Montado Ibérico': [['Pan', 30, 'g'], ['Jamon Serrano', 10, 'g'], ['Queso crema', 5, 'g'], ['Mermelada', 15, 'g'], ['Perejil', 1, 'pieza']],
  'Montado Castellano': [['Pan', 30, 'g'], ['Salchichon', 7, 'g'], ['Chorizo', 7, 'g'], ['Manchego', 7, 'g']],
  'Coco Spritz': [['Aperol', 60, 'ml'], ['Absolut 750 ml', 60, 'ml'], ['Calahua', 90, 'ml'], ['Madrileña', 30, 'ml'], ['Limón', 0.5, 'pieza']],
  'Pizza Castellana': [['Harina', 160, 'g'], ['Agua natural', 100, 'ml'], ['Prego', 50, 'g'], ['Salchichon', 25, 'g'], ['Chorizo', 25, 'g'], ['Mozzarella', 40, 'g']],
  'Mojito Tinto': [['Bacardi', 60, 'ml'], ['Limón', 1.5, 'pieza'], ['Madrileña', 29.57, 'ml'], ['Hierba buena', 3, 'g'], ['Sprite', 180, 'ml'], ['Tinto California', 20, 'ml']],
  'Piña Colada': [['Calahua', 118.29, 'ml'], ['Piña', 60, 'g'], ['Jugo de Piña', 200, 'ml']],
  'Pizza Margarita': [['Harina', 160, 'g'], ['Agua natural', 100, 'ml'], ['Prego', 50, 'g'], ['Mozzarella', 40, 'g']],
  'Limonada Ibérica': [['Limón', 2, 'pieza'], ['Madrileña', 29.57, 'ml'], ['Sprite', 150, 'ml'], ['Frutos rojos', 20, 'g'], ['Agua natural', 100, 'ml', 'agua/hielo de servicio']],
  'Tequila Sunrise': [['Hacienda de Tepa', 59.15, 'ml'], ['Limón', 1, 'pieza'], ['Jugo de Naranja', 160, 'ml'], ['Agua Mineral', 130, 'ml'], ['Aperol', 29.57, 'ml']],
  'Mezcalita Tamarindo': [['400 Conejos 700 ml', 59.15, 'ml'], ['Madrileña', 29.57, 'ml'], ['Limón', 1.5, 'pieza'], ['Saborizante tamarindo', 29.57, 'ml'], ['Squirt', 150, 'ml']],
  'Gin Tonic Verde': [['Pepino', 30, 'g'], ['Limón', 0.5, 'pieza'], ['Ginebra Gibsons', 59.15, 'ml'], ['Tonica', 110, 'ml'], ['Sprite', 100, 'ml'], ['Romero', 1, 'pieza']],
  Ronchata: [['Bacardi', 59.15, 'ml'], ['Carnation', 59.15, 'ml'], ['Lechera', 29.57, 'ml'], ['Concentrado de horchata', 29.57, 'ml'], ['Agua natural', 100, 'ml']],
  'Tinto de Verano': [['Tinto California', 177.44, 'ml'], ['Limón', 0.5, 'pieza'], ['Sprite', 120, 'ml']],
  'Stella Artois': [['Stella', 1, 'pieza']],
  'Margarita de Fresa': [['Hacienda de Tepa', 59.15, 'ml'], ['Limón', 3, 'pieza'], ['Madrileña', 29.57, 'ml'], ['Fanta Roja', 150, 'ml'], ['Fresas', 20, 'g']],
  'Mojito Clásico': [['Bacardi', 60, 'ml'], ['Limón', 1.5, 'pieza'], ['Madrileña', 29.57, 'ml'], ['Hierba buena', 3, 'g'], ['Sprite', 200, 'ml']],
  'Gin Tonic Rosa': [['Frutos rojos', 20, 'g'], ['Ginebra Gibsons', 59.15, 'ml'], ['Tonica', 110, 'ml'], ['Sprite', 100, 'ml'], ['Tinto California', 20, 'ml'], ['Romero', 1, 'pieza']],
  'Pizza Catalana': [['Harina', 160, 'g'], ['Agua natural', 100, 'ml'], ['Prego', 50, 'g'], ['Mozzarella', 40, 'g'], ['Mermelada', 40, 'g'], ['Salchichon', 20, 'g'], ['Chorizo', 20, 'g']],
  Modelo: [['Modelo', 1, 'pieza']],
  'Gin Tonic Rojo': [['Frutos rojos', 20, 'g'], ['Ginebra Gibsons', 59.15, 'ml'], ['Tonica', 110, 'ml'], ['Sprite', 100, 'ml'], ['Tinto California', 20, 'ml'], ['Romero', 1, 'pieza']],
  'Negroni Ibérico': [['Frutos rojos', 20, 'g'], ['Ginebra Gibsons', 29.57, 'ml'], ['Campari', 29.57, 'ml'], ['Vermouth Rojo', 14.79, 'ml'], ['Limón', 0.5, 'pieza'], ['Sprite', 150, 'ml']],
  'Paloma Chica': [['Limón', 2, 'pieza'], ['Hacienda de Tepa', 59.15, 'ml'], ['Squirt', 200, 'ml']],
  Affogato: [['Nieve', 100, 'g'], ['Café espresso', 5, 'g']],
  'Cubanito Grande': [['Arriero', 118.29, 'ml']],
};

async function main() {
  const stores = await prisma.stores.findMany({ where: { negocio_id: NEGOCIO }, select: { id: true } });
  const defaultStore = stores[0]?.id;
  if (!defaultStore) throw new Error('No hay tienda para crear los productos faltantes');

  for (const m of metadata) {
    const existing = await prisma.products.findFirst({ where: { negocio_id: NEGOCIO, name: m.nombre } });
    if (!existing) continue;
    await prisma.products.update({ where: { id: existing.id }, data: {
      unit_cost: m.costo === undefined ? undefined : m.costo,
      unidad_base: m.unidad_base,
      contenido_compra: m.contenido_compra,
      unidad_compra: m.unidad_compra,
      rendimiento_util: m.rendimiento_util ?? 1,
    } });
  }

  for (const [nombre, costo] of [['Viuda de Sánchez', 100], ['Michemix', 89] ] as const) {
    await prisma.products.upsert({
      where: { negocio_id_name: { negocio_id: NEGOCIO, name: nombre } },
      create: { negocio_id: NEGOCIO, name: nombre, store_id: defaultStore, base_qty: 0, active: true, unit_cost: costo, unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella', rendimiento_util: 1 },
      update: { unit_cost: costo, active: true, unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella', rendimiento_util: 1 },
    });
  }

  const productos = await prisma.products.findMany({ where: { negocio_id: NEGOCIO, active: true }, select: { id: true, name: true } });
  const ids = new Map(productos.map((p) => [p.name, p.id]));
  const missing = new Set<string>();
  for (const [nombre, lineas] of Object.entries(recipes)) {
    for (const [producto] of lineas) if (!ids.has(producto)) missing.add(producto);
    if (lineas.some(([producto]) => !ids.has(producto))) continue;
    const menu = await prisma.productos_menu.upsert({
      where: { negocio_id_nombre: { negocio_id: NEGOCIO, nombre } },
      create: { negocio_id: NEGOCIO, nombre, activo: true },
      update: { activo: true },
    });
    const previous = await prisma.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    if (previous) continue;
    await prisma.recetas.create({ data: {
      producto_menu_id: menu.id,
      version: 1,
      estado: 'validada',
      fuente: 'Recetas confirmadas en la sesión de costeo Ibérico; piloto Epos 10–16 agosto 2026',
      notas: nombre === 'Copa de la Casa' ? 'Porción estándar provisional de 6 oz; medir copa real para confirmar.' : null,
      lineas: { create: lineas.map(([producto, cantidad, unidad, nota]) => ({ product_id: ids.get(producto)!, cantidad, unidad, nota: nota ?? null })) },
    } });
  }
  // Hielo se documenta como servicio operativo, no como insumo costeadable
  // hasta confirmar presentación y rendimiento; evita dejar una línea con
  // costo inventado en la Piñada.
  const hieloId = ids.get('Hielo');
  const pinada = await prisma.productos_menu.findUnique({ where: { negocio_id_nombre: { negocio_id: NEGOCIO, nombre: 'Piñada' } }, select: { id: true } });
  if (hieloId && pinada) {
    const version = await prisma.recetas.findFirst({ where: { producto_menu_id: pinada.id }, orderBy: { version: 'desc' }, select: { id: true } });
    if (version) await prisma.receta_lineas.deleteMany({ where: { receta_id: version.id, product_id: hieloId } });
  }
  console.log(JSON.stringify({ ok: true, recetas_intentadas: Object.keys(recipes).length, productos_actualizados: metadata.length, faltantes: [...missing] }, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
