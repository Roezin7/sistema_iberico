import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const FUENTE = 'Hoja de ruta bebidas · corrección Perla Negra 2026-09-12';
const MARCA = 'PERLA-NEGRA-VOLT-SPRITE-2026-09-12';

const result = await prisma.$transaction(async (tx) => {
  const menu = await tx.productos_menu.findFirst({
    where: { negocio_id: NEGOCIO, nombre: 'Perla Negra', activo: true },
    include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: { include: { products: { select: { name: true } } } } } } },
  });
  if (!menu) throw new Error('Perla Negra no existe en producción');
  const latest = menu.recetas[0];
  const current = (latest?.lineas ?? []).map((l) => `${l.products.name}|${Number(l.cantidad)}|${l.unidad}`).sort();
  const desired = ['Jagger|2|oz', 'Sprite|200|ml', 'Volt|200|ml'].sort();
  if (JSON.stringify(current) === JSON.stringify(desired)) return { status: 'ya_aplicada', receta: latest.id, version: latest.version };

  const products = await tx.products.findMany({ where: { negocio_id: NEGOCIO, name: { in: ['Jagger', 'Volt', 'Sprite'] } }, select: { id: true, name: true } });
  const byName = new Map(products.map((p) => [p.name, p.id]));
  for (const name of ['Jagger', 'Volt', 'Sprite']) if (!byName.has(name)) throw new Error(`Producto faltante: ${name}`);
  const max = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const recipe = await tx.recetas.create({
    data: {
      producto_menu_id: menu.id,
      version: (max?.version ?? 0) + 1,
      estado: 'validada',
      fuente: FUENTE,
      notas: `${MARCA}. Perla Negra lleva 200 ml de Volt y 200 ml de Sprite.`,
      vigente_desde: new Date('2026-09-12T00:00:00.000Z'),
      lineas: { create: [
        { product_id: byName.get('Jagger'), cantidad: 2, unidad: 'oz' },
        { product_id: byName.get('Volt'), cantidad: 200, unidad: 'ml' },
        { product_id: byName.get('Sprite'), cantidad: 200, unidad: 'ml' },
      ] },
    },
  });
  return { status: 'creada', receta: recipe.id, version: recipe.version };
});

console.log(JSON.stringify({ ok: true, result }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
