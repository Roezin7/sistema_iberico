import { prisma } from './server/dist/db.js';
const ids = [52n,54n,51n,85n,78n,96n,3n,15n];
const rows = await prisma.inventory_lots.findMany({ where: { negocio_id: 1n, product_id: { in: ids }, ticket_ref: { not: null } }, orderBy: { id: 'asc' }, select: { id: true, product_id: true, ticket_ref: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, fuente: true } });
const menus = await prisma.productos_menu.findMany({ where: { negocio_id: 1n, epos_product_id: { in: [2365913, 2364538] } }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1, include: { lineas: true } } } });
console.log(JSON.stringify({ rows, menus }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
