/** Confirmación del propietario: Botella en Epos = servicio completo.
 * Conserva como principal el artículo que ya posee el ID remoto. Crea una
 * versión de receta y desactiva su duplicado, sin borrar registros ni recostear.
 * Epos sólo se consulta. Dry-run por defecto; --apply aplica en transacción.
 */
import { Prisma, PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const business = 1n;
const effective = new Date('2026-11-03T00:00:00Z');
const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? Number(x) : x, 2);
const specs = [
  { name: '1800 Cristalino Botella', duplicate: 'Servicio 1800 Cristalino', epos: 3036870, product: 19n, qty: 700, unit: 'ml' },
  { name: 'Dobel Diamante Botella', duplicate: 'Servicio Dobel Diamante', epos: 3036867, product: 18n, qty: 700, unit: 'ml' },
  { name: 'Tequila 8 Botella', duplicate: 'Servicio Tequila 8', epos: 3273776, product: 79n, qty: 1, unit: 'pieza' },
];
const recipeInclude = { recetas: { orderBy: { version: 'desc' }, include: { lineas: { orderBy: { product_id: 'asc' } } } } };
function lines(s) {
  return [
    { product_id: s.product, cantidad: s.qty, unidad: s.unit, nota: `Botella completa de la marca correspondiente: ${s.qty} ${s.unit}.` },
    { product_id: 27n, cantidad: 3000, unidad: 'ml', nota: '5 aguas minerales pequeñas de 600 ml; 3,000 ml en total.' },
    { product_id: 26n, cantidad: 2, unidad: 'pieza', nota: '2 refrescos Coca de 450 ml, según ticket de Farmacia Guadalajara.' },
  ];
}
function sameLines(actual, desired) {
  return actual.length === desired.length && desired.every(d => actual.some(a => a.product_id === d.product_id && Number(a.cantidad) === d.cantidad && a.unidad === d.unidad && a.nota === d.nota));
}
async function main() {
  if (!process.env.EPOS_API_KEY || !process.env.EPOS_API_SECRET) throw Error('Faltan credenciales Epos');
  const root = (process.env.EPOS_API_BASE_URL || 'https://api.eposnowhq.com/api').replace(/\/+$/, '').replace(/\/api(?:\/V2)?$/i, '');
  const auth = Buffer.from(`${process.env.EPOS_API_KEY}:${process.env.EPOS_API_SECRET}`).toString('base64');
  const all = await db.productos_menu.findMany({ where: { negocio_id: business }, include: recipeInclude });
  const ingredients = await db.products.findMany({ where: { negocio_id: business, id: { in: [19n, 18n, 79n, 27n, 26n] } } });
  const plans = [];
  for (const s of specs) {
    const response = await fetch(`${root}/api/V2/Product/${s.epos}`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Epos ${s.epos}: ${response.status}`);
    const remote = await response.json();
    if (remote.ProductID !== s.epos || remote.Name !== s.name || remote.SellOnTill !== true || !Number.isFinite(remote.SalePrice) || remote.SalePrice <= 0) throw Error(`SKU remoto inesperado: ${s.name}`);
    const main = all.find(m => m.nombre === s.name);
    const duplicate = all.find(m => m.nombre === s.duplicate);
    if (!main?.activo || main.epos_product_id !== s.epos || !duplicate || duplicate.epos_product_id != null) throw Error(`Asociación local inesperada: ${s.name}`);
    if (all.some(m => m.id !== main.id && m.epos_product_id === s.epos)) throw Error(`ID duplicado: ${s.epos}`);
    for (const l of lines(s)) {
      const product = ingredients.find(p => p.id === l.product_id);
      if (!product?.active || product.unidad_base !== l.unidad) throw Error(`Unidad o insumo inválido: ${l.product_id}`);
    }
    const current = main.recetas.find(r => r.estado === 'validada');
    const matches = current && sameLines(current.lineas, lines(s));
    plans.push({ spec: s, main, duplicate, price: remote.SalePrice, createRecipe: !matches, version: (main.recetas[0]?.version ?? 0) + 1 });
  }
  console.log(json({ modo: APPLY ? 'apply' : 'dry-run', confirmacion: 'Propietario confirma los tres servicios completos con 5 minerales de 600 ml + 2 refrescos', planes: plans.map(p => ({ principal: p.main.nombre, menu_id: p.main.id, epos_id: p.spec.epos, precio: p.price, desactivar: p.duplicate.activo ? p.duplicate.nombre : null, nueva_version: p.createRecipe ? p.version : null, lineas: lines(p.spec) })) }));
  if (!APPLY) return;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1120261103::bigint)`;
    const ids = plans.flatMap(p => [p.main.id, p.duplicate.id]);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM productos_menu WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    for (const plan of plans) {
      const { main, duplicate, spec, price, createRecipe, version } = plan;
      for (const expected of [main, duplicate]) {
        const current = await tx.productos_menu.findUniqueOrThrow({ where: { id: expected.id }, include: recipeInclude });
        if (json(current) !== json(expected)) throw Error('Cambio concurrente: repetir vista previa');
      }
      const newOwner = await tx.productos_menu.findFirst({ where: { negocio_id: business, epos_product_id: spec.epos, id: { not: main.id } } });
      if (newOwner) throw Error('ID ocupado durante unificación');
      if (createRecipe) {
        await tx.recetas.create({ data: { producto_menu_id: main.id, version, estado: 'validada', vigente_desde: effective, fuente: 'Confirmación explícita del propietario 2026-11-03: el artículo Botella de Epos es el servicio completo.', notas: `Unifica ${duplicate.nombre} (#${duplicate.id}) en ${main.nombre} (#${main.id}). Incluye botella + 5 minerales de 600 ml + 2 refrescos Coca de 450 ml. No recalcula ventas históricas.`, lineas: { create: lines(spec) } } });
      }
      if (Number(main.precio_venta) !== price) await tx.productos_menu.update({ where: { id: main.id }, data: { precio_venta: price } });
      if (duplicate.activo) await tx.productos_menu.update({ where: { id: duplicate.id }, data: { activo: false } });
      if (createRecipe || duplicate.activo || Number(main.precio_venta) !== price) {
        await tx.auditoria_eventos.create({ data: { negocio_id: business, entidad: 'producto_menu', entidad_id: String(main.id), accion: 'unificar_servicio_tequila', antes: json({ main, duplicate }), despues: json({ main: await tx.productos_menu.findUnique({ where: { id: main.id }, include: recipeInclude }), duplicate: await tx.productos_menu.findUnique({ where: { id: duplicate.id }, include: recipeInclude }) }), metadata: json({ confirmacion_propietario: true, epos_solo_lectura: true, sin_recosteo_historico: true, sin_borrados: true, fecha_efectiva: effective.toISOString().slice(0, 10) }) } });
      }
    }
  }, { timeout: 20000 });
  console.log('Unificación completada; no se modificaron ventas, lotes, pagos ni Epos.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
