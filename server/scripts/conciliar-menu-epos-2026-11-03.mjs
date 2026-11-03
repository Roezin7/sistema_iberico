/** Conciliación puntual verificada contra Product v2. Sólo LEE Epos.
 * Dry-run por defecto; --apply actualiza el catálogo local con bitácora.
 * No modifica ventas, cobros, lotes ni costos históricos.
 * Ejecutar con DATABASE_URL y credenciales Epos del entorno protegido.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const negocio = 1n;
const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v, 2);
const targets = [
  { name: 'Café americano', id: 3978590, remote: 'Café americano' },
  { name: 'Shot de 400 Conejos', id: 2364539, remote: 'Shot de 400 Conejos' },
  { name: 'Servicio Bacardi', id: 4055736, remote: 'Servicio Bacardi' },
  { name: 'Servicio Hacienda de Tepa', id: 2364534, remote: 'Servicio de Hacienda de Tepa Blanco' },
  { name: 'Jim Beam Rocas', id: 3632848, remote: 'Jim Beam Rocas' },
  { name: 'Servicio Jim Beam', id: 4040672, remote: 'Servicio Jim Bean ACTUALIZADO' },
  { name: 'Cuba de Dobel Diamante', id: 3504178, remote: 'Cuba de Dobel Diamante' },
];
async function main() {
  if (!process.env.EPOS_API_KEY || !process.env.EPOS_API_SECRET) throw Error('Faltan credenciales Epos');
  const root = (process.env.EPOS_API_BASE_URL || 'https://api.eposnowhq.com/api').replace(/\/+$/, '').replace(/\/api(?:\/V2)?$/i, '');
  const auth = Buffer.from(`${process.env.EPOS_API_KEY}:${process.env.EPOS_API_SECRET}`).toString('base64');
  const remote = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${root}/api/V2/Product?page=${page}`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw Error(`Epos respondió ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw Error('Catálogo Epos inesperado');
    remote.push(...rows);
    if (rows.length < 200) break;
    if (page === 50) throw Error('Catálogo truncado: no se aplicó nada');
  }
  const local = await prisma.productos_menu.findMany({ where: { negocio_id: negocio } });
  const plans = targets.map(t => {
    const menu = local.find(m => m.nombre === t.name && m.activo);
    const product = remote.find(p => p.ProductID === t.id);
    if (!menu || !product || product.Name !== t.remote || product.SellOnTill !== true || !Number.isFinite(product.SalePrice) || product.SalePrice <= 0) throw Error(`Evidencia inválida: ${t.name}`);
    if (local.some(m => m.activo && m.id !== menu.id && m.epos_product_id === t.id)) throw Error(`ID ya asignado: ${t.id}`);
    return { menu, product };
  });
  const shot = remote.find(p => p.ProductID === 4040675);
  if (shot?.Name !== 'Shot Jim Beam whiskey' || shot.SellOnTill !== true || !(shot.SalePrice > 0)) throw Error('Shot Jim Beam no verificable');
  const existingShot = local.find(m => m.nombre === shot.Name);
  if (existingShot && existingShot.epos_product_id !== shot.ProductID) throw Error('Shot local conflictivo');
  const template = await prisma.recetas.findFirst({ where: { productos_menu: { negocio_id: negocio, nombre: 'Jim Beam Rocas' }, estado: 'validada' }, orderBy: { version: 'desc' }, include: { lineas: true } });
  if (!template || template.lineas.length !== 1 || template.lineas[0].product_id !== 20n || Number(template.lineas[0].cantidad) !== 2 || template.lineas[0].unidad !== 'oz') throw Error('Receta de 2 oz no verificable');
  console.log(stringify({ modo: APPLY ? 'apply' : 'dry-run', productos_epos: remote.length, cambios: plans.map(({ menu, product }) => ({ menu: menu.nombre, antes: { id: menu.epos_product_id, precio: menu.precio_venta }, despues: { id: product.ProductID, precio: product.SalePrice }, fuente: product.Name })), shot: { crear: !existingShot, id: shot.ProductID, precio: shot.SalePrice, receta: '2 oz Jim Beam, confirmada por propietario' } }));
  if (!APPLY) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1120261103::bigint)`;
    for (const { menu, product } of plans) {
      const current = await tx.productos_menu.findUniqueOrThrow({ where: { id: menu.id } });
      if (current.epos_product_id !== menu.epos_product_id || String(current.precio_venta) !== String(menu.precio_venta)) throw Error('Cambio concurrente: repetir vista previa');
      if (current.epos_product_id === product.ProductID && Number(current.precio_venta) === product.SalePrice) continue;
      const duplicate = await tx.productos_menu.findFirst({ where: { negocio_id: negocio, activo: true, epos_product_id: product.ProductID, id: { not: menu.id } } });
      if (duplicate) throw Error('ID ocupado durante conciliación');
      const updated = await tx.productos_menu.update({ where: { id: menu.id }, data: { epos_product_id: product.ProductID, precio_venta: product.SalePrice } });
      await tx.auditoria_eventos.create({ data: { negocio_id: negocio, entidad: 'producto_menu', entidad_id: String(menu.id), accion: 'conciliar_epos', antes: stringify(current), despues: stringify(updated), metadata: stringify({ fuente: 'Epos Product v2, consulta directa', remoto: product.Name, fecha: new Date().toISOString(), solo_lectura_remota: true }) } });
    }
    if (!existingShot) {
      const menu = await tx.productos_menu.create({ data: { negocio_id: negocio, nombre: shot.Name, epos_product_id: shot.ProductID, precio_venta: shot.SalePrice, recetas: { create: { version: 1, estado: 'validada', vigente_desde: new Date('2026-11-03'), fuente: 'Separación de Rocas y Shot: dos SKU distintos en catálogo Epos; propietario confirma shot de 2 oz', lineas: { create: [{ product_id: 20n, cantidad: 2, unidad: 'oz', nota: '2 oz Jim Beam según instrucción del propietario' }] } } } } });
      await tx.auditoria_eventos.create({ data: { negocio_id: negocio, entidad: 'producto_menu', entidad_id: String(menu.id), accion: 'separar_shot_rocas', despues: stringify(menu), metadata: stringify({ fuente: 'Epos Product v2', receta_fuente: Number(template.id), sin_recosteo_historico: true }) } });
    }
  });
  console.log('Conciliación aplicada. Epos, ventas e inventario no fueron modificados.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
