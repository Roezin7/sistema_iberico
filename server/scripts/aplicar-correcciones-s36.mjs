import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const TICKET = 'APERTURA-FALTANTES-S36-2026-09-08';
const out = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const week = await tx.semanas.findFirst({ where: { id: 66n, negocio_id: NEGOCIO }, select: { id: true, fecha_inicio: true, inventario_semanal: { select: { apertura_snapshot_id: true } } } });
    if (!week) throw new Error('No existe semana 66');
    const mozzarellaPurchases = await tx.purchase_lines.count({ where: { product_id: 52n, purchases: { is: { negocio_id: NEGOCIO, fecha_recepcion: { gte: new Date('2026-08-31'), lt: new Date('2026-09-07') } } } } });
    if (mozzarellaPurchases !== 0) throw new Error('Se encontro una compra de Mozzarella en semana 36; detener');

    const opening = [
      { id: 52n, qty: 530, cost: 0.15, name: 'Mozzarella' },
      { id: 54n, qty: 60, cost: 80 / 1810, name: 'Fresas' },
      { id: 51n, qty: 3, cost: 2, name: 'Hierbabuena' },
      { id: 85n, qty: 8, cost: 5 / 50, name: 'Perejil' },
      { id: 78n, qty: 50, cost: 255 / 3000, name: 'Queso amarillo' },
      { id: 96n, qty: 29.57, cost: 0.1, name: 'Viuda de Sanchez' },
    ];
    const lots = [];
    for (const item of opening) {
      let lot = await tx.inventory_lots.findFirst({ where: { negocio_id: NEGOCIO, product_id: item.id, ticket_ref: TICKET } });
      if (!lot) lot = await tx.inventory_lots.create({ data: { negocio_id: NEGOCIO, product_id: item.id, recibido_at: week.fecha_inicio, cantidad_inicial: item.qty, cantidad_restante: item.qty, costo_unitario: item.cost, moneda: 'MXN', fuente: 'inventario_inicial', ticket_ref: TICKET, notas: `Inventario inicial no registrado detectado al costear semana 36 (${item.name}); autorizado 2026-09-08. No modifica el conteo fisico de cierre. Snapshot apertura: ${week.inventario_semanal?.apertura_snapshot_id ?? 'sin enlace'}.` } });
      lots.push({ productId: item.id, name: item.name, id: lot.id, quantity: lot.cantidad_inicial, remaining: lot.cantidad_restante, cost: lot.costo_unitario });
    }

    const vino = await tx.products.update({ where: { id: 3n }, data: { unit_cost: 239 } });
    const vinoLots = await tx.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, product_id: 3n, fuente: { not: 'historico_prueba' }, estado: { in: ['abierto', 'agotado'] } }, select: { id: true } });
    for (const lot of vinoLots) await tx.inventory_lots.update({ where: { id: lot.id }, data: { costo_unitario: 239 / 750 } });
    const history = await tx.producto_costos_historicos.create({ data: { product_id: 3n, fecha: new Date('2026-09-08'), costo: 239 } });

    async function ensureMenu(name, epos, price, ingredient, qty, note) {
      let menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, epos_product_id: epos } });
      if (!menu) menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, nombre: name } });
      if (!menu) menu = await tx.productos_menu.create({ data: { negocio_id: NEGOCIO, nombre: name, epos_product_id: epos, precio_venta: price, activo: true } });
      else menu = await tx.productos_menu.update({ where: { id: menu.id }, data: { nombre: name, epos_product_id: epos, precio_venta: price, activo: true } });
      let recipe = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id, estado: 'validada' }, orderBy: { version: 'desc' } });
      if (!recipe) {
        const latest = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
        recipe = await tx.recetas.create({ data: { producto_menu_id: menu.id, version: (latest?.version ?? 0) + 1, estado: 'validada', fuente: 'Correccion operativa semana 36', notas: note, vigente_desde: new Date('2026-08-31'), lineas: { create: [{ product_id: ingredient, cantidad: qty, unidad: 'ml', nota: note }] } } });
      }
      return { id: menu.id, name: menu.nombre, epos, recipeId: recipe.id, recipeVersion: recipe.version };
    }
    const finca = await ensureMenu('Finca las Moras Merlot', 2365913, 360, 3n, 750, 'Se trata como vino tinto en botella; costo vigente $239 por botella.');
    const shot = await ensureMenu('Shot de Hacienda de Tepa Blanco', 2364538, 60, 15n, 59.15, 'Dos onzas de Hacienda de Tepa Blanco (59.15 ml).');
    return { week: week.id, mozzarellaPurchases, lots, vino: { id: vino.id, unitCost: vino.unit_cost, lotsUpdated: vinoLots.length, historyId: history.id }, finca, shot };
  }, { maxWait: 60000, timeout: 120000 });
  console.log(out({ ok: true, result }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
