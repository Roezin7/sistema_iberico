import { prisma } from './server/dist/db.js';
const ids = [8n,44n,14n,67n,81n,53n,60n,4n,47n,59n,45n,46n,52n,57n,55n,26n,41n,48n,15n,20n,1n,32n,50n,7n,28n,88n,104n];
const lines = await prisma.inventory_lines.findMany({ where: { snapshot_id: { in: [62n,63n] }, product_id: { in: ids } }, orderBy: [{ product_id: 'asc' }, { snapshot_id: 'asc' }, { zona_id: 'asc' }], include: { inventory_snapshot: { select: { id: true, created_at: true, tipo: true, semana_id: true } }, zonas_inventario: { select: { id: true, nombre: true } }, products: { select: { id: true, name: true, unidad_base: true, unidad_compra: true, contenido_compra: true, unit_cost: true } } } });
const units = await prisma.product_zone_units.findMany({ where: { product_id: { in: ids } }, select: { product_id: true, zona_id: true, unidad_captura: true, factor: true } });
console.log(JSON.stringify({ lines, units }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
