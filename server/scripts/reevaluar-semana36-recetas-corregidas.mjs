import { PrismaClient } from '@prisma/client';
import { convertirCantidad } from '../dist/recetas/costeo.js';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const FROM = new Date('2026-08-31T06:00:00.000Z');
const TO = new Date('2026-09-07T06:00:00.000Z');
const START_DATE = new Date('2026-08-31T00:00:00.000Z');
const endDate = new Date('2026-09-07T23:59:59.999Z');
const out = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);

function fifoConsume(lots, productId, qty, saleDate, changes) {
  let remaining = qty;
  for (const lot of lots.filter((l) => l.product_id === productId && l.remaining > 0 && l.recibido_at <= saleDate)) {
    if (remaining <= 0.000001) break;
    const take = Math.min(remaining, lot.remaining);
    if (take > 0) changes.push({ lot, qty: take, cost: lot.costo_unitario });
    remaining -= take;
  }
  return remaining;
}

async function main() {
  const [sales, menus, lots, priorConsumptions, products] = await Promise.all([
    prisma.epos_ventas.findMany({ where: { negocio_id: NEGOCIO, fecha: { gte: FROM, lt: TO } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] }),
    prisma.productos_menu.findMany({ where: { negocio_id: NEGOCIO, activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'asc' }, include: { lineas: { include: { products: { select: { name: true, unidad_base: true } } } } } } } }),
    prisma.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, recibido_at: { lte: endDate }, fuente: { not: 'historico_prueba' } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }] }),
    prisma.inventory_consumptions.findMany({ where: { negocio_id: NEGOCIO, fecha: { lt: START_DATE }, cantidad: { gt: 0 }, OR: [{ fuente: { startsWith: 'venta_fifo_vivo' } }, { fuente: 'venta_receta' }, { fuente: 'venta_receta_historica' }] }, select: { lote_id: true, cantidad: true } }),
    prisma.products.findMany({ where: { negocio_id: NEGOCIO }, select: { id: true, unidad_base: true } }),
  ]);
  const unitByProduct = new Map(products.map((p) => [p.id.toString(), p.unidad_base]));
  const baseLots = lots.map((l) => ({ id: l.id, product_id: l.product_id, recibido_at: l.recibido_at, remaining: Number(l.cantidad_inicial) - priorConsumptions.filter((c) => c.lote_id === l.id).reduce((s, c) => s + Number(c.cantidad), 0), costo_unitario: Number(l.costo_unitario) })).filter((l) => l.remaining > 0.000001);
  const byEpos = new Map(menus.filter((m) => m.epos_product_id != null).map((m) => [m.epos_product_id, m]));
  const affectedMenus = new Set(['Mezcalita Piña','Mezcalita Mango','Perla Negra','Paloma Chica','Paloma Grande','Limonada Ibérica','Limonada','Piña Colada','Cubanito Chico','Cubanito Grande']);
  const choose = (menu, corrected) => {
    const valid = menu.recetas.filter((r) => !(r.fuente ?? '').includes('correcciones manuscritas'));
    const historical = valid.filter((r) => r.vigente_desde == null || r.vigente_desde <= START_DATE);
    if (!corrected) return historical.at(-1) ?? valid.at(-1) ?? null;
    const correctedRecipe = menu.recetas.filter((r) => (r.fuente ?? '').includes('correcciones manuscritas') && (r.vigente_desde == null || r.vigente_desde <= START_DATE)).at(-1);
    return correctedRecipe ?? (affectedMenus.has(menu.nombre) ? historical.at(-1) ?? null : valid.at(-1) ?? null);
  };
  function simulate(corrected) {
    const state = baseLots.map((l) => ({ ...l }));
    let total = 0, costed = 0, exceptions = 0, pending = 0, units = 0; const pendingNames = new Set();
    const affected = new Map();
    for (const sale of sales) {
      units += Number(sale.cantidad);
      const menu = byEpos.get(sale.epos_product_id);
      const recipe = menu ? choose(menu, corrected) : null;
      if (!recipe) { pending++; pendingNames.add(menu?.nombre ?? sale.producto_nombre); continue; }
      const changes = []; let saleCost = 0; let error = null;
      for (const line of recipe.lineas) {
        const baseUnit = unitByProduct.get(line.product_id.toString());
        const qty = convertirCantidad(Number(line.cantidad) * Number(sale.cantidad), line.unidad, baseUnit);
        if (qty == null) { error = `unidad ${line.products.name}`; break; }
        const before = changes.length;
        const missing = fifoConsume(state, line.product_id, qty, sale.fecha, changes);
        if (missing > 0.0001) { error = `faltante ${line.products.name} ${missing.toFixed(4)}`; break; }
        for (const c of changes.slice(before)) saleCost += c.qty * c.cost;
      }
      if (error) { exceptions++; continue; }
      for (const c of changes) c.lot.remaining -= c.qty;
      total += saleCost; costed++;
      if (menu && ['Mezcalita Piña','Mezcalita Mango','Perla Negra','Paloma Chica','Paloma Grande','Limonada Ibérica','Limonada','Piña Colada','Cubanito Chico','Cubanito Grande'].includes(menu.nombre)) affected.set(menu.nombre, (affected.get(menu.nombre) ?? 0) + Number(sale.cantidad));
    }
    return { costo_fifo: Number(total.toFixed(4)), ventas_costeadas: costed, excepciones: exceptions, pendientes: pending, pendientes_productos: [...pendingNames], unidades: units, affected: Object.fromEntries(affected) };
  }
  const before = simulate(false); const after = simulate(true);
  const actual = sales.reduce((s, v) => s + (v.costo_fifo == null ? 0 : Number(v.costo_fifo)), 0);
  console.log(out({ ok: true, semana: 36, periodo: { from: FROM, to: TO }, ventas: sales.length, actual_costo_fifo: Number(actual.toFixed(4)), simulacion_receta_anterior: before, simulacion_receta_corregida: after, impacto_recetas: Number((after.costo_fifo - before.costo_fifo).toFixed(4)), nota: 'Simulación en memoria; no reescribe ventas ni consumos FIFO históricos. Las recetas corregidas quedan vigentes desde el inicio de semana 36.' }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
