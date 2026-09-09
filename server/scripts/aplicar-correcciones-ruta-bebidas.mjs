import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const VIGENTE_DESDE = new Date('2026-08-31T12:00:00.000Z');
const FUENTE = 'Hoja de ruta bebidas · correcciones manuscritas 2026-09-09';
const MARCA = 'RUTA-BEBIDAS-CORREGIDA-2026-09-09';
const out = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const products = await tx.products.findMany({ where: { negocio_id: NEGOCIO }, select: { id: true, name: true, unidad_base: true } });
    const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
    const product = (name) => {
      const p = byName.get(name.toLowerCase());
      if (!p) throw new Error(`Producto de receta no encontrado: ${name}`);
      return p;
    };
    const aguaMineral = product('Agua Mineral').id;
    const sprite = product('Sprite').id;
    const squirt = product('Squirt').id;
    const volt = product('Volt').id;
    const bacardi = product('Bacardi').id;
    const frutosRojos = product('Frutos rojos').id;
    const aguaNatural = product('Agua natural').id;

    const specs = new Map([
      ['Mezcalita Piña', { remove: [squirt], note: 'Se elimina Squirt según hoja de ruta corregida.' }],
      ['Mezcalita Mango', { remove: [squirt], note: 'Se elimina Squirt según hoja de ruta corregida.' }],
      ['Perla Negra', { replace: [[volt, sprite]], note: 'Volt se sustituye por Sprite según hoja de ruta corregida.' }],
      ['Paloma Chica', { replace: [[squirt, aguaMineral]], note: 'Squirt se sustituye por Agua Mineral según hoja de ruta corregida.' }],
      ['Paloma Grande', { replace: [[squirt, aguaMineral]], note: 'Squirt se sustituye por Agua Mineral según hoja de ruta corregida.' }],
      ['Limonada Ibérica', { replace: [[aguaNatural, aguaMineral]], note: 'Agua natural se sustituye por Agua Mineral. Frutos rojos se conserva en 20 g.' }],
      ['Limonada', { replace: [[aguaNatural, aguaMineral]], note: 'Agua natural se sustituye por Agua Mineral.' }],
      ['Piña Colada', { add: [{ product_id: bacardi, cantidad: 59.15, unidad: 'ml', nota: '2 oz Bacardi' }], note: 'Se agregan 2 oz Bacardi.' }],
      ['Cubanito Chico', { add: [{ product_id: frutosRojos, cantidad: 0, unidad: 'g', nota: 'Frutos rojos para decorar; cantidad pendiente, no se descuenta FIFO.' }], note: 'Frutos rojos para decorar. Al no existir cantidad, se deja como nota operativa sin consumo FIFO.' }],
      ['Michelada Chica', { note: 'Anotación operativa: toque de Clamato y 1/2 limón. No se agrega al FIFO hasta registrar producto y cantidad exacta.' }],
      ['Piñada', { note: 'Anotación operativa: hielo (2 cucharadas). No se agrega al FIFO porque la unidad del catálogo es bolsa/pieza.' }],
      ['Vampiro Chico', { note: 'Anotación operativa: toque de Valentina. No se agrega al FIFO hasta registrar producto y cantidad exacta.' }],
      ['Vampiro Grande', { note: 'Anotación operativa: toque de Valentina. No se agrega al FIFO hasta registrar producto y cantidad exacta.' }],
    ]);

    // Cubanito Grande is explicitly the double of the corrected Chico.
    const chico = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, nombre: 'Cubanito Chico', activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: true } } } });
    if (!chico?.recetas[0]) throw new Error('No existe receta validada de Cubanito Chico');
    specs.set('Cubanito Grande', { absolute: chico.recetas[0].lineas.map((l) => ({ product_id: l.product_id, cantidad: Number(l.cantidad) * 2, unidad: l.unidad, nota: l.nota ? `${l.nota}; doble de Cubanito Chico` : 'Doble de Cubanito Chico' })), note: 'Se define como el doble de Cubanito Chico. Las cantidades se duplican en todas sus líneas.' });

    const updated = [];
    for (const [name, spec] of specs) {
      const menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, nombre: name, activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: true } } } });
      if (!menu?.recetas[0]) throw new Error(`No existe receta validada de ${name}`);
      const latest = menu.recetas[0];
      if (latest.fuente === FUENTE && (latest.notas ?? '').includes(MARCA)) { updated.push({ name, status: 'ya_aplicada', receta: latest.id, version: latest.version }); continue; }
      let lines = latest.lineas.map((l) => ({ product_id: l.product_id, cantidad: Number(l.cantidad), unidad: l.unidad, nota: l.nota ?? null }));
      if (spec.absolute) lines = spec.absolute;
      if (spec.remove) lines = lines.filter((l) => !spec.remove.some((id) => id === l.product_id));
      for (const [from, to] of spec.replace ?? []) {
        lines = lines.map((l) => l.product_id === from ? { ...l, product_id: to } : l);
      }
      for (const add of spec.add ?? []) {
        if (add.cantidad === 0) continue;
        if (!lines.some((l) => l.product_id === add.product_id)) lines.push(add);
      }
      const maxVersion = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const notes = `${MARCA}. ${spec.note}`;
      const recipe = await tx.recetas.create({ data: { producto_menu_id: menu.id, version: (maxVersion?.version ?? 0) + 1, estado: 'validada', fuente: FUENTE, notas: notes, vigente_desde: VIGENTE_DESDE, lineas: { create: lines.map((l) => ({ product_id: l.product_id, cantidad: l.cantidad, unidad: l.unidad, nota: l.nota })) } }, include: { lineas: true } });
      updated.push({ name, status: 'creada', receta: recipe.id, version: recipe.version, lineas: recipe.lineas.length });
    }
    return { vigente_desde: VIGENTE_DESDE, updated };
  }, { maxWait: 60000, timeout: 120000 });
  console.log(out({ ok: true, result }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
