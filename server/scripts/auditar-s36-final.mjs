import { prisma } from './server/dist/db.js';
import { resumen, saludOperativa, listarExcepcionesCosteoSemana } from './server/dist/finanzas/service.js';
const product = await prisma.products.findFirst({ where: { negocio_id: 1n, name: 'Frutos secos' }, select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true, unidad_compra: true } });
const lots = product ? await prisma.inventory_lots.findMany({ where: { negocio_id: 1n, product_id: product.id }, orderBy: { id: 'asc' }, select: { id: true, recibido_at: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, estado: true, fuente: true, ticket_ref: true } }) : [];
const purchases = product ? await prisma.purchase_lines.findMany({ where: { product_id: product.id, purchases: { is: { negocio_id: 1n } } }, include: { purchases: { select: { id: true, fecha_recepcion: true, proveedor: true, estado: true } } }, orderBy: { purchases: { fecha_recepcion: 'asc' } } }) : [];
const recipe = await prisma.receta_lineas.findMany({ where: { product_id: product?.id }, include: { recetas: { include: { productos_menu: { select: { nombre: true } } } } } });
const result = { product, lots, purchases, recipe, exceptions: await listarExcepcionesCosteoSemana(1n, 66n), summary: await resumen(1n, 66n), health: await saludOperativa(1n) };
console.log(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
