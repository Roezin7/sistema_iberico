/** Corrección documentada de tres entradas, no edición libre de tickets.
 * Dry-run por defecto. --apply conserva pagos, conteos y consumos históricos.
 * La diferencia de costo ya aplicado se revela en bitácora; no se contabiliza
 * como gasto de caja ni se reabre una semana cerrada silenciosamente.
 */
import { Prisma, PrismaClient } from '@prisma/client';
const APPLY = process.argv.includes('--apply');
const business = 1n;
const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? Number(x) : x, 2);
const round = (v, n) => Math.round((v + Number.EPSILON) * 10 ** n) / 10 ** n;
const specs = [
  { lot: 1244n, purchase: 91n, product: 7n, name: 'Bacardi', source: 'IB-20261022-LACOMER-24604580', old: 1500, qty: 1400, amount: 487.5, bottleCost: 243.75 },
  { lot: 1242n, purchase: 91n, product: 20n, name: 'Jim Beam', source: 'IB-20261022-LACOMER-24604580', old: 1500, qty: 1400, amount: 878, bottleCost: 439 },
  { lot: 1284n, purchase: 99n, product: 18n, name: 'Tequila Dobel', source: 'LACOMER-24677373', old: 750, qty: 700, amount: 849 },
];
function assert(ok, message) { if (!ok) throw Error(message); }
export function planificarSaldo(initial, remaining, paid, correctedQty, consumptions) {
  assert([initial, remaining, paid, correctedQty].every(Number.isFinite), 'Valores no finitos');
  assert(initial > 0 && correctedQty > 0 && paid >= 0 && remaining >= 0 && remaining <= initial, 'Saldo inválido');
  assert(consumptions.every(c => Number.isFinite(c.qty) && Number.isFinite(c.cost) && c.qty > 0 && c.cost >= 0), 'Consumo inesperado');
  const consumed = round(consumptions.reduce((s, c) => s + c.qty, 0), 4);
  assert(Math.abs(initial - remaining - consumed) < 0.0002, 'Saldo no concilia con consumos: requiere revisión individual');
  assert(correctedQty >= consumed, 'La entrada corregida no cubre los consumos existentes');
  const cost = round(paid / correctedQty, 6);
  return { initial: correctedQty, remaining: round(correctedQty - consumed, 4), cost,
    consumedUnchanged: consumed,
    historicalCostUnchanged: round(consumptions.reduce((s, c) => s + c.cost, 0), 4),
    historicalCostDifference: round(consumptions.reduce((s, c) => s + round(c.qty * cost, 4) - c.cost, 0), 4) };
}
async function main() {
  const db = new PrismaClient({ errorFormat: 'minimal' });
  try {
    const plans = [];
    for (const s of specs) {
      const lot = await db.inventory_lots.findUniqueOrThrow({ where: { id: s.lot }, include: { consumptions: { orderBy: { id: 'asc' } }, transferencias: true } });
      const purchase = await db.purchases.findUniqueOrThrow({ where: { id: s.purchase }, include: { purchase_lines: { where: { product_id: s.product } }, capture_lines: { where: { product_id: s.product } } } });
      const product = await db.products.findUniqueOrThrow({ where: { id: s.product }, include: { product_zone_units: true } });
      assert(lot.negocio_id === business && lot.product_id === s.product && lot.purchase_id === s.purchase && !lot.transferencias.length, 'Identidad o transferencia inesperada');
      assert(purchase.negocio_id === business && purchase.ticket_ref === s.source && purchase.estado === 'confirmada' && purchase.purchase_lines.length === 1, 'Ticket no verificable');
      assert(product.negocio_id === business && product.name === s.name && product.unidad_base === 'ml', 'Producto no verificable');
      assert(Math.abs(Number(purchase.purchase_lines[0].importe) - s.amount) < 0.0001, 'Importe distinto de la evidencia');
      const previous = await db.auditoria_eventos.findFirst({ where: { negocio_id: business, entidad: 'inventory_lot', entidad_id: String(s.lot), accion: 'corregir_presentacion_20261103' } });
      const already = Number(lot.cantidad_inicial) === s.qty;
      if (already) assert(previous, 'Cantidad ya cambiada sin esta bitácora: revisar');
      else assert(Number(lot.cantidad_inicial) === s.old && !previous && Number(purchase.purchase_lines[0].qty) === s.old, 'Estado modificado: repetir auditoría');
      assert(lot.consumptions.every(c => c.fuente === 'venta_receta' && c.epos_venta_id != null), 'No se corrigen lotes con ajustes/reversiones por esta ruta');
      const plan = planificarSaldo(Number(lot.cantidad_inicial), Number(lot.cantidad_restante), s.amount, s.qty, lot.consumptions.map(c => ({ qty: Number(c.cantidad), cost: Number(c.costo_total) })));
      plans.push({ spec: s, lot, purchase, product, plan, already });
    }
    const menus = await db.productos_menu.findMany({ where: { negocio_id: business, nombre: { in: ['Servicio Bacardi', 'Servicio Jim Beam'] } }, include: { recetas: { orderBy: { version: 'desc' }, include: { lineas: { orderBy: { product_id: 'asc' } } } } } });
    assert(menus.length === 2 && menus.every(m => m.activo && m.epos_product_id > 0), 'Servicios no verificables');
    const ingredients = await db.products.findMany({ where: { negocio_id: business, id: { in: [26n, 27n] } } });
    assert(ingredients.some(p => p.id === 26n && p.unidad_base === 'pieza') && ingredients.some(p => p.id === 27n && p.unidad_base === 'ml'), 'Mezcladores no verificables');
    const desiredLines = m => [
      { product_id: m.nombre === 'Servicio Bacardi' ? 7n : 20n, cantidad: 700, unidad: 'ml', nota: 'Botella de 700 ml según ticket La Comer pedido 24604580.' },
      { product_id: 27n, cantidad: 3000, unidad: 'ml', nota: '5 aguas minerales pequeñas de 600 ml.' },
      { product_id: 26n, cantidad: 2, unidad: 'pieza', nota: '2 refrescos Coca de 450 ml.' },
    ];
    const needsRecipe = m => { const r = m.recetas.find(r => r.estado === 'validada'); const desired = desiredLines(m); return !r || r.lineas.length !== 3 || !desired.every(d => r.lineas.some(l => l.product_id === d.product_id && Number(l.cantidad) === d.cantidad && l.unidad === d.unidad && l.nota === d.nota)); };
    console.log(json({ modo: APPLY ? 'apply' : 'dry-run', lotes: plans.map(p => ({ producto: p.spec.name, lote: p.spec.lot, ya_aplicado: p.already, antes: { cantidad: p.lot.cantidad_inicial, restante: p.lot.cantidad_restante, costo_ml: p.lot.costo_unitario }, despues: p.plan })), recetas_nuevas: menus.filter(needsRecipe).map(m => ({ nombre: m.nombre, version: (m.recetas[0]?.version ?? 0) + 1, lineas: desiredLines(m) })), politica: 'No alterar pagos, snapshots, ventas ni sus consumos/costos previos. La diferencia histórica se documenta como pendiente no monetario, no se simula un gasto.' }));
    if (!APPLY) return;
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1120261103::bigint)`;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM inventory_lots WHERE id IN (${Prisma.join(specs.map(s => s.lot))}) ORDER BY id FOR UPDATE`);
      for (const p of plans) {
        const current = await tx.inventory_lots.findUniqueOrThrow({ where: { id: p.spec.lot }, include: { consumptions: { orderBy: { id: 'asc' } }, transferencias: true } });
        const currentPurchase = await tx.purchases.findUniqueOrThrow({ where: { id: p.spec.purchase }, include: { purchase_lines: { where: { product_id: p.spec.product } }, capture_lines: { where: { product_id: p.spec.product } } } });
        const currentProduct = await tx.products.findUniqueOrThrow({ where: { id: p.spec.product }, include: { product_zone_units: true } });
        assert(json(current) === json(p.lot) && json(currentPurchase) === json(p.purchase) && json(currentProduct) === json(p.product), 'Cambio concurrente: reintentar vista previa');
        if (p.already) continue;
        const { spec: s, plan } = p;
        const reason = 'Corrección de presentación 2026-11-03 con ticket/confirmación del propietario: 700 ml. Se preservan pagos y consumos históricos; antes/después en bitácora.';
        const updated = await tx.inventory_lots.update({ where: { id: s.lot }, data: { cantidad_inicial: plan.initial, cantidad_restante: plan.remaining, costo_unitario: plan.cost, notas: [p.lot.notas, reason].filter(Boolean).join('\n') } });
        await tx.purchase_lines.update({ where: { purchase_id_product_id: { purchase_id: s.purchase, product_id: s.product } }, data: { qty: s.qty, contenido_compra: 700, unidad_compra: 'botella', costo_unitario: plan.cost } });
        for (const cl of p.purchase.capture_lines) await tx.purchase_capture_lines.update({ where: { id: cl.id }, data: { cantidad_base: s.qty, contenido_compra: 700, costo_unitario: plan.cost, notas: [cl.notas, reason].filter(Boolean).join('\n') } });
        if (s.bottleCost != null) {
          const actualizado = await tx.products.update({ where: { id: s.product }, data: { contenido_compra: 700, unit_cost: s.bottleCost, presentacion_modo: 'por_lote', presentacion_nota: 'Ticket verificado de 700 ml. Hay otros formatos históricos: exigir contenido real por compra; no convertir automáticamente toda botella a 700/750 ml.' } });
          const { registrarCambioCostoCatalogo } = await import(process.argv[1] === '-' ? './server/dist/inventario/costos-historicos.js' : '../dist/inventario/costos-historicos.js');
          await registrarCambioCostoCatalogo(tx, p.product, actualizado, new Date(), 'correccion_presentacion_20261103');
          await tx.product_zone_units.updateMany({ where: { product_id: s.product, unidad_captura: 'botella', factor: { in: [700, 750] } }, data: { factor: 700 } });
        }
        await tx.auditoria_eventos.create({ data: { negocio_id: business, entidad: 'inventory_lot', entidad_id: String(s.lot), accion: 'corregir_presentacion_20261103', antes: json({ lote: p.lot, compra: p.purchase, producto: p.product }), despues: json({ lote: updated, compra: await tx.purchases.findUnique({ where: { id: s.purchase }, include: { purchase_lines: { where: { product_id: s.product } }, capture_lines: { where: { product_id: s.product } } } }), producto: await tx.products.findUnique({ where: { id: s.product }, include: { product_zone_units: true } }) }), metadata: json({ evidencia: s.source, contenido_verificado_ml: 700, consumos_historicos_conservados: p.lot.consumptions.map(c => Number(c.id)), diferencia_costo_historico_no_reexpresado: plan.historicalCostDifference, requiere_conciliacion_costo_historico: plan.historicalCostDifference !== 0, sin_movimiento_de_dinero: true, sin_cambio_conteos: true }) } });
      }
      for (const m of menus) {
        const current = await tx.productos_menu.findUniqueOrThrow({ where: { id: m.id }, include: { recetas: { orderBy: { version: 'desc' }, include: { lineas: { orderBy: { product_id: 'asc' } } } } } });
        assert(json(current) === json(m), 'Receta cambió concurrentemente');
        if (!needsRecipe(m)) continue;
        const recipe = await tx.recetas.create({ data: { producto_menu_id: m.id, version: (m.recetas[0]?.version ?? 0) + 1, estado: 'validada', vigente_desde: new Date('2026-11-03T00:00:00Z'), fuente: 'Tickets del propietario + instrucción de corregir conversiones y completar Servicio Jim Beam.', notas: 'Botella 700 ml + 5 minerales 600 ml + 2 refrescos 450 ml. Versión prospectiva; no recostea ventas anteriores.', lineas: { create: desiredLines(m) } }, include: { lineas: true } });
        await tx.auditoria_eventos.create({ data: { negocio_id: business, entidad: 'producto_menu', entidad_id: String(m.id), accion: 'corregir_servicio_700ml', antes: json(m), despues: json(recipe), metadata: json({ vigente_desde: '2026-11-03', historial_conservado: true }) } });
      }
      // Recalcular observaciones desde la evidencia corregida, sin duplicarlas.
      const { registrarPresentacionesObservadas } = await import(process.argv[1] === '-' ? './server/dist/inventario/presentaciones.js' : '../dist/inventario/presentaciones.js');
      await registrarPresentacionesObservadas(tx, 91n);
    }, { timeout: 30000 });
    console.log('Correcciones aplicadas. Diferencia histórica Jim Beam documentada; cierre financiero no ejecutado.');
  } finally { await db.$disconnect(); }
}
if (process.argv[1] === '-' || process.argv[1]?.endsWith('/corregir-presentaciones-2026-11-03.mjs')) main().catch(e => { console.error(e.message); process.exitCode = 1; });
