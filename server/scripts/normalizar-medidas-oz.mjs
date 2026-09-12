import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const VIGENTE_DESDE = new Date('2026-08-31T12:00:00.000Z');
const FUENTE = 'Hoja de ruta bebidas · medidas normalizadas a oz 2026-09-10';
const OZ_ML = 29.5735;
const MARCA = 'OZ-NORMALIZADO-2026-09-10';
const esMedidaDeBar = (name) => /(absolut|aperol|bacardi|baileys|campari|ginebra|gibsons|jagger|hacienda|mezcal|conejos|madrileña|licor|vermouth|viuda|arriero|tequila|dobel|1800|jim beam|prosecco|vino tinto|tinto california|calahua|crema de coco|carnation|lechera|saborizante|concentrado de horchata)/i.test(name);
const nearHalfOz = (ml) => { const raw = ml / OZ_ML; const n = Math.round(raw * 2) / 2; return Math.abs(raw - n) <= 0.04 ? n : null; };

const result = await prisma.$transaction(async (tx) => {
  const menus = await tx.productos_menu.findMany({ where: { negocio_id: NEGOCIO, activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: { include: { products: { select: { name: true, unidad_base: true } } } } } } } });
  const updated = [];
  for (const menu of menus) {
    const latest = menu.recetas[0];
    if (!latest) continue;
    if ((latest.fuente ?? '').includes(MARCA) && !latest.lineas.some((line) => line.unidad.toLowerCase() === 'ml' && line.products?.unidad_base === 'ml' && esMedidaDeBar(line.products.name) && nearHalfOz(Number(line.cantidad)) != null)) continue;
    const lines = latest.lineas.map((line) => {
      const qty = Number(line.cantidad);
      const n = line.unidad.toLowerCase() === 'ml' && line.products.unidad_base === 'ml' && esMedidaDeBar(line.products.name) ? nearHalfOz(qty) : null;
      return n == null ? { product_id: line.product_id, cantidad: qty, unidad: line.unidad, nota: line.nota ?? null } : { product_id: line.product_id, cantidad: n, unidad: 'oz', nota: line.nota ? `${line.nota}; medida normalizada a oz` : 'Medida normalizada a oz' };
    });
    if (!lines.some((line, i) => line.unidad === 'oz' && latest.lineas[i]?.unidad !== 'oz')) continue;
    const maxVersion = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const recipe = await tx.recetas.create({ data: { producto_menu_id: menu.id, version: (maxVersion?.version ?? 0) + 1, estado: 'validada', fuente: FUENTE, notas: `${MARCA}. Conversión de medidas equivalentes a onzas; mezcladores permanecen en ml.`, vigente_desde: VIGENTE_DESDE, lineas: { create: lines } } });
    updated.push({ menu: menu.nombre, receta: recipe.id, version: recipe.version, convertidas: lines.filter((line) => line.unidad === 'oz').length });
  }
  return updated;
});
console.log(JSON.stringify({ ok: true, updated: result }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
await prisma.$disconnect();
