import { prisma } from './server/dist/db.js';
const purchases = await prisma.purchases.findMany({
  where: { negocio_id: 1n, fecha_recepcion: { gte: new Date('2026-09-04'), lt: new Date('2026-09-05') }, proveedor: { contains: 'Lacteos', mode: 'insensitive' } },
  include: { purchase_lines: { include: { products: { select: { id: true, name: true, unidad_base: true, contenido_compra: true, unit_cost: true } } } } },
  orderBy: { id: 'asc' },
});
const mozzarella = await prisma.purchase_lines.findMany({ where: { products: { name: { contains: 'mozz', mode: 'insensitive' } }, purchases: { is: { negocio_id: 1n } } }, include: { products: { select: { id: true, name: true, unidad_base: true, contenido_compra: true, unit_cost: true } }, purchases: { select: { id: true, fecha_recepcion: true, proveedor: true, total: true, ticket_ref: true, estado: true } } }, orderBy: { purchases: { fecha_recepcion: 'asc' } } });
const captures = await prisma.purchase_capture_lines.findMany({ where: { purchase_id: 32n }, select: { id: true, product_id: true, tipo_linea: true, descripcion_fuente: true, cantidad_fuente: true, unidad_fuente: true, cantidad_base: true, unidad_compra: true, contenido_compra: true, costo_unitario: true, importe: true, notas: true } });
console.log(JSON.stringify({ purchases: purchases.map(({ foto_data, ...p }) => p), mozzarella, captures }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
