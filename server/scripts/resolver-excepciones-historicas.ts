import { prisma } from '../src/db.js';
import { listarExcepcionesCosteoSemana, persistirConciliacionInventarioSemana } from '../src/finanzas/service.js';
import { costearVentasPendientesEnVivo } from '../src/inventario/consumo-epos.js';

const NEGOCIO_ID = 1n;
const WEEKS = [67n, 68n];
const MAX_ITERATIONS = 1;
const MARKER = 'AJUSTE-HISTORICO-SIN-EVIDENCIA';
const RUN_ID = Date.now().toString();

async function costearConReintentos(from?: Date, to?: Date) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await costearVentasPendientesEnVivo({ negocioId: NEGOCIO_ID, from, to });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('lote FIFO cambió')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function parseMissing(detail: string) {
  const match = detail.match(/^Inventario insuficiente: (.+); faltan ([0-9]+(?:\.[0-9]+)?) (g|ml|pieza)$/i);
  if (!match) return null;
  return { name: match[1]!.trim(), qty: Number(match[2]), unit: match[3]!.toLowerCase() };
}

async function main() {
  const weeks = await prisma.semanas.findMany({
    where: { negocio_id: NEGOCIO_ID, id: { in: WEEKS } },
    select: { id: true, fecha_inicio: true },
  });
  const weekStart = new Map(weeks.map((week) => [week.id.toString(), week.fecha_inicio]));

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const requested = new Map<string, { weekId: bigint; name: string; qty: number; unit: string; date: Date }>();
    for (const weekId of WEEKS) {
      const exceptions = await listarExcepcionesCosteoSemana(NEGOCIO_ID, weekId);
      for (const group of exceptions.filter((item) => item.causa === 'inventario')) {
        for (const detail of group.detalles) {
          const parsed = parseMissing(detail);
          if (!parsed) continue;
          const key = `${weekId}:${parsed.name}:${parsed.unit}`;
          const previous = requested.get(key);
          if (previous) previous.qty += parsed.qty;
          else requested.set(key, { weekId, ...parsed, date: weekStart.get(weekId.toString())! });
        }
      }
    }

    if (!requested.size) break;
    const products = await prisma.products.findMany({
      where: { negocio_id: NEGOCIO_ID, name: { in: [...new Set([...requested.values()].map((row) => row.name))] } },
      select: { id: true, name: true, unit_cost: true, contenido_compra: true, unidad_base: true },
    });
    const byName = new Map(products.map((product) => [product.name, product]));
    const data: any[] = [];
    for (const row of requested.values()) {
      const product = byName.get(row.name);
      if (!product) throw new Error(`No existe producto para el faltante: ${row.name}`);
      if (product.unidad_base && product.unidad_base !== row.unit) {
        throw new Error(`Unidad incompatible para ${row.name}: catálogo=${product.unidad_base}, faltante=${row.unit}`);
      }
      const unitCost = Number(product.unit_cost ?? 0) / Number(product.contenido_compra ?? 1);
      const ticketRef = `${MARKER}-W${row.weekId.toString()}-${row.name}-R${RUN_ID}-I${iteration}`;
      const exists = await prisma.inventory_lots.findFirst({ where: { negocio_id: NEGOCIO_ID, ticket_ref: ticketRef }, select: { id: true } });
      if (exists) continue;
      data.push({
        negocio_id: NEGOCIO_ID,
        product_id: product.id,
        purchase_id: null,
        recibido_at: row.date,
        cantidad_inicial: row.qty,
        cantidad_restante: row.qty,
        costo_unitario: unitCost,
        moneda: 'MXN',
        estado: 'abierto',
        fuente: 'ajuste_inventario',
        ticket_ref: ticketRef,
        notas: `Ajuste histórico autorizado sin comprobante para resolver faltante de costeo de semana ${row.weekId.toString()}. No es compra y no afecta Banco. Unidad: ${row.unit}.`,
      });
    }
    if (data.length) await prisma.inventory_lots.createMany({ data });
    console.log(`iteración ${iteration}: ajustes creados ${data.length}, faltantes detectados ${requested.size}`);
    // Procesar una venta por transacción evita que un lote recién ajustado sea
    // planificado dos veces dentro de una misma corrida histórica.
    const ranges = weeks.map((week) => ({ gte: week.fecha_inicio, lt: new Date(week.fecha_inicio.getTime() + 7 * 86400000) }));
    const pending = await prisma.epos_ventas.findMany({
      where: { negocio_id: NEGOCIO_ID, costeo_estado: { in: ['pendiente', 'excepcion'] }, OR: ranges.map((fecha) => ({ fecha })) },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
      select: { id: true, fecha: true },
    });
    let costeadas = 0;
    for (const venta of pending) {
      const result = await costearConReintentos(venta.fecha, new Date(venta.fecha.getTime() + 1));
      costeadas += result.costeadas;
    }
    console.log(`costeo individual: ${costeadas} ventas nuevas`);
  }

  for (const weekId of WEEKS) {
    const remaining = await listarExcepcionesCosteoSemana(NEGOCIO_ID, weekId);
    await persistirConciliacionInventarioSemana(NEGOCIO_ID, weekId);
    console.log(`semana ${weekId.toString()}`, JSON.stringify(remaining));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
