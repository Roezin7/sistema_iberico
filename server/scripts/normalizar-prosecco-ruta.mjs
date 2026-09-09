import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const NEGOCIO = 1n;
const names = ['Aperol Spritz', 'Raspberry Spritz'];
const source = 'Hoja de ruta bebidas · normalización Prosecco 2026-09-09';
const result = await prisma.$transaction(async (tx) => {
  const output = [];
  for (const name of names) {
    const menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, nombre: name, activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: true } } } });
    if (!menu?.recetas[0]) throw new Error(`No existe receta validada de ${name}`);
    const latest = menu.recetas[0];
    const prosecco = latest.lineas.find((line) => line.product_id === 12n);
    if (!prosecco) throw new Error(`No existe Prosecco en ${name}`);
    if (Number(prosecco.cantidad) === 118.29 && latest.fuente === source) { output.push({ name, status: 'ya_aplicada', version: latest.version }); continue; }
    const maxVersion = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const lines = latest.lineas.map((line) => ({ product_id: line.product_id, cantidad: line.product_id === 12n ? 118.29 : Number(line.cantidad), unidad: line.unidad, nota: line.nota ?? null }));
    const recipe = await tx.recetas.create({ data: { producto_menu_id: menu.id, version: (maxVersion?.version ?? 0) + 1, estado: 'validada', fuente: source, notas: '118.29 ml de Prosecco según hoja de ruta física.', vigente_desde: new Date('2026-08-31T12:00:00.000Z'), lineas: { create: lines } } });
    output.push({ name, status: 'creada', version: recipe.version, receta: recipe.id });
  }
  return output;
});
console.log(JSON.stringify({ ok: true, result }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
await prisma.$disconnect();
