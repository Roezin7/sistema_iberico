/**
 * Reconstruye las aperturas/cierres históricos hacia atrás desde el último
 * inventario físico. El snapshot ancla se trata como inmutable: no se edita,
 * ni se tocan compras, lotes ni consumos.
 *
 * Uso:
 *   tsx scripts/reconstruir-historico-desde-ancla.ts --apply
 *
 * Las cantidades negativas que resultan de la reconstrucción se fijan en cero
 * (un inventario físico no puede ser negativo) y se documentan en la nota del
 * snapshot como excepciones pendientes. Esto evita convertir un error de
 * compra/receta en una existencia ficticia.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO_ID = 1n;
const ANCLA_ID = 93n;
const SEMANA_MIN = 64n;
const SEMANA_MAX = 70n;
const MARKER = 'FASE 2 — RECONSTRUCCIÓN HISTÓRICA DESDE ANCLA 93';
const APPLY = process.argv.includes('--apply');

type Movement = { purchase: Map<string, number>; consumption: Map<string, number> };
type Balance = Map<string, number>;

const n = (v: unknown) => Number(v ?? 0);
const key = (id: bigint | number | string) => String(id);
const round4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function add(map: Map<string, number>, id: bigint | number | string, value: number) {
  const k = key(id);
  map.set(k, round4((map.get(k) ?? 0) + value));
}

function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function nextDay(d: Date) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

function mapSum(map: Map<string, number>) {
  let total = 0;
  for (const v of map.values()) total += v;
  return round4(total);
}

async function main() {
  const anchor = await prisma.inventory_snapshot.findUnique({
    where: { id: ANCLA_ID },
    select: { id: true, negocio_id: true, created_at: true, tipo: true, semana_id: true, motivo: true, nota: true },
  });
  if (!anchor || anchor.negocio_id !== NEGOCIO_ID) throw new Error('No se encontró el snapshot ancla 93 del negocio 1.');

  const weeks = await prisma.semanas.findMany({
    where: { negocio_id: NEGOCIO_ID, id: { gte: SEMANA_MIN, lte: SEMANA_MAX } },
    orderBy: { id: 'desc' },
    select: { id: true, fecha_inicio: true, fecha_fin: true },
  });
  if (weeks.length !== Number(SEMANA_MAX - SEMANA_MIN + 1n)) {
    throw new Error(`Se esperaban ${SEMANA_MAX - SEMANA_MIN + 1n} semanas y sólo se encontraron ${weeks.length}.`);
  }

  // El ancla es la única fuente de existencia física actual. Se conserva el
  // reparto Local/Bodega y el factor de captura por producto al crear saldos
  // inferidos anteriores.
  const anchorLines = await prisma.inventory_lines.findMany({
    where: { snapshot_id: ANCLA_ID },
    select: { product_id: true, zona_id: true, qty_captura: true, factor: true },
  });
  const balance: Balance = new Map();
  const zoneLayout = new Map<string, { zonaId: bigint; factor: number; base: number }[]>();
  for (const line of anchorLines) {
    const product = key(line.product_id);
    const base = round4(n(line.qty_captura) * n(line.factor));
    add(balance, product, base);
    const rows = zoneLayout.get(product) ?? [];
    rows.push({ zonaId: line.zona_id, factor: n(line.factor) || 1, base });
    zoneLayout.set(product, rows);
  }

  const allProducts = await prisma.products.findMany({
    where: { negocio_id: NEGOCIO_ID },
    select: { id: true, name: true, active: true, unit_cost: true, contenido_compra: true },
  });
  const productName = new Map(allProducts.map(p => [key(p.id), p.name]));
  const productCost = new Map<string, number | null>();
  for (const p of allProducts) {
    const precio = p.unit_cost == null ? null : n(p.unit_cost);
    const contenido = p.contenido_compra == null ? null : n(p.contenido_compra);
    productCost.set(key(p.id), precio != null && contenido != null && contenido > 0 ? precio / contenido : null);
  }
  const zoneUnits = await prisma.product_zone_units.findMany({
    where: { products: { negocio_id: NEGOCIO_ID } },
    select: { product_id: true, zona_id: true, factor: true },
  });
  const fallbackFactors = new Map<string, { zonaId: bigint; factor: number }[]>();
  for (const z of zoneUnits) {
    const k = key(z.product_id);
    const rows = fallbackFactors.get(k) ?? [];
    rows.push({ zonaId: z.zona_id, factor: n(z.factor) || 1 });
    fallbackFactors.set(k, rows);
  }

  const reconstructed: { semanaId: bigint; snapshotId: bigint; total: number; value: number; negatives: { name: string; qty: number }[] }[] = [];
  const movementByWeek = new Map<string, Movement>();

  for (const week of weeks) {
    const endExclusive = nextDay(week.fecha_fin);
    const [lots, consumptions] = await Promise.all([
      prisma.inventory_lots.findMany({
        where: {
          negocio_id: NEGOCIO_ID,
          recibido_at: { gte: week.fecha_inicio, lt: endExclusive },
          purchase_id: { not: null },
          estado: { not: 'cancelado' },
        },
        select: { product_id: true, cantidad_inicial: true },
      }),
      prisma.inventory_consumptions.findMany({
        where: {
          negocio_id: NEGOCIO_ID,
          fecha: { gte: week.fecha_inicio, lt: endExclusive },
          cantidad: { gt: 0 },
          OR: [
            { fuente: { startsWith: 'venta_fifo_vivo' } },
            { fuente: 'venta_receta' },
            { fuente: 'venta_receta_historica' },
          ],
        },
        select: { product_id: true, cantidad: true },
      }),
    ]);
    const purchase = new Map<string, number>();
    const consumption = new Map<string, number>();
    for (const lot of lots) add(purchase, lot.product_id, n(lot.cantidad_inicial));
    for (const row of consumptions) add(consumption, row.product_id, n(row.cantidad));
    movementByWeek.set(key(week.id), { purchase, consumption });
  }

  // Se procesa de la semana más reciente hacia la más antigua. El saldo
  // calculado antes de una semana es: cierre - compras + consumo.
  for (const week of weeks) {
    const mv = movementByWeek.get(key(week.id))!;
    const ids = new Set([...balance.keys(), ...mv.purchase.keys(), ...mv.consumption.keys()]);
    const negatives: { name: string; qty: number }[] = [];
    const previous: Balance = new Map();
    for (const id of ids) {
      const inferred = round4((balance.get(id) ?? 0) - (mv.purchase.get(id) ?? 0) + (mv.consumption.get(id) ?? 0));
      if (inferred < -0.004) negatives.push({ name: productName.get(id) ?? `Producto ${id}`, qty: round4(-inferred) });
      previous.set(id, Math.max(0, inferred));
    }

    // La apertura de la semana más antigua sólo es necesaria para semana 64;
    // cada snapshot intermedio sirve simultáneamente como cierre de la semana
    // anterior y apertura de la siguiente.
    const markerMotivo = `${MARKER} · semana ${week.id.toString()} · límite ${dateOnly(week.fecha_inicio)}`;
    const markerNota = [
      'Saldo inferido hacia atrás desde el snapshot físico 93; no es un conteo físico.',
      `Fórmula: cierre posterior − compras confirmadas + consumo FIFO activo de ${dateOnly(week.fecha_inicio)} a ${dateOnly(week.fecha_fin)}.`,
      negatives.length ? `Excepciones por saldo negativo (se fijaron en 0): ${negatives.slice(0, 20).map(x => `${x.name} ${x.qty}`).join('; ')}${negatives.length > 20 ? `; +${negatives.length - 20} más` : ''}.` : 'Sin saldos negativos inferidos.',
      'El snapshot físico ancla 93 no se modifica.',
    ].join(' ');

    let snapshot = await prisma.inventory_snapshot.findFirst({ where: { negocio_id: NEGOCIO_ID, motivo: markerMotivo }, select: { id: true } });
    if (!snapshot && APPLY) {
      // Created_at se deja antes del ancla para que inventarioActual siga
      // seleccionando 93 como la existencia vigente.
      const createdAt = new Date(`${dateOnly(week.fecha_inicio)}T06:00:00.000Z`);
      snapshot = await prisma.inventory_snapshot.create({
        data: { negocio_id: NEGOCIO_ID, tipo: 'ajuste', semana_id: week.id, motivo: markerMotivo, nota: markerNota, created_at: createdAt },
        select: { id: true },
      });
      const lines: { snapshot_id: bigint; product_id: bigint; zona_id: bigint; qty_captura: number; factor: number }[] = [];
      for (const [id, total] of previous) {
        if (total <= 0.004) continue;
        const layout = zoneLayout.get(id) ?? [];
        const targets = layout.length ? layout : (fallbackFactors.get(id) ?? [{ zonaId: 1n, factor: 1 }]).map(x => ({ ...x, base: 0 }));
        const layoutSum = layout.reduce((s, x) => s + Math.max(0, x.base), 0);
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          const share = layoutSum > 0 ? Math.max(0, t.base) / layoutSum : (i === 0 ? 1 : 0);
          const base = round4(total * share);
          const qty = round2(base / (t.factor || 1));
          if (qty <= 0) continue;
          lines.push({ snapshot_id: snapshot.id, product_id: BigInt(id), zona_id: t.zonaId, qty_captura: qty, factor: t.factor || 1 });
        }
      }
      if (lines.length) await prisma.inventory_lines.createMany({ data: lines, skipDuplicates: true });
      await prisma.inventory_snapshot.update({ where: { id: snapshot.id }, data: { nota: markerNota } });
    }
    let value = Math.round([...previous.entries()].reduce((sum, [id, qty]) => sum + qty * (productCost.get(id) ?? 0), 0) * 100) / 100;
    // La fuente de verdad de los importes semanales es la misma que usa la
    // aplicación para valorar un snapshot. Las líneas se redondean a la
    // unidad de captura permitida por la tabla, por lo que el valor real puede
    // diferir unos centavos del saldo inferido antes de persistirlas.
    if (APPLY && snapshot) {
      const rows = await prisma.$queryRaw<Array<{ valor: number | string }>>`
        SELECT COALESCE(SUM(il.qty_captura * il.factor * (p.unit_cost / NULLIF(p.contenido_compra, 0))), 0) AS valor
        FROM inventory_lines il
        JOIN products p ON p.id = il.product_id
        WHERE il.snapshot_id = ${snapshot.id}
      `;
      value = Math.round(n(rows[0]?.valor) * 100) / 100;
    }
    if (!snapshot) {
      // Dry-run still advances the balance and prints the candidate.
      reconstructed.push({ semanaId: week.id, snapshotId: 0n, total: mapSum(previous), value, negatives });
    } else {
      reconstructed.push({ semanaId: week.id, snapshotId: snapshot.id, total: mapSum(previous), value, negatives });
    }
    balance.clear();
    for (const [id, value] of previous) balance.set(id, value);
  }

  if (APPLY) {
    // reconstructed está en orden 70…64. El snapshot de cada semana es la
    // apertura de esa semana y, simultáneamente, el cierre de la semana
    // anterior. El único cierre que no se infiere es el de la semana 70: es
    // exactamente el snapshot físico ancla 93.
    const byWeek = new Map(reconstructed.map(x => [key(x.semanaId), x]));
    for (const week of weeks) {
      const r = byWeek.get(key(week.id))!;
      const valor = r.value;
      await prisma.inventario_semanal.update({
        where: { semana_id: week.id },
        data: { apertura_snapshot_id: r.snapshotId, apertura_valor: valor, apertura_origen: `${MARKER} · snapshot ${r.snapshotId}` },
      });
      if (week.id > SEMANA_MIN) {
        await prisma.inventario_semanal.update({
          where: { semana_id: week.id - 1n },
          data: { cierre_snapshot_id: r.snapshotId, cierre_valor: valor },
        });
      }
      if (week.id === SEMANA_MIN) {
        await prisma.inventario_semanal.update({
          where: { semana_id: week.id },
          data: { apertura_snapshot_id: r.snapshotId, apertura_valor: valor },
        });
      }
    }
    // Nunca se actualiza el cierre de la semana 70: sigue siendo el físico 93.
    await prisma.inventario_semanal.update({ where: { semana_id: SEMANA_MAX }, data: { cierre_snapshot_id: ANCLA_ID } });
  }

  console.log(JSON.stringify({
    apply: APPLY,
    anchor: { id: anchor.id.toString(), created_at: anchor.created_at.toISOString(), tipo: anchor.tipo },
    reconstructed: reconstructed.map(r => ({ semana: r.semanaId.toString(), snapshot: r.snapshotId.toString(), total_base: r.total, valor_catalogo: r.value, excepciones: r.negatives.length, top: r.negatives.sort((a, b) => b.qty - a.qty).slice(0, 8) })),
    note: APPLY ? 'Snapshot 93 preservado; cadena histórica enlazada a snapshots inferidos.' : 'Dry-run; usar --apply para crear/enlazar snapshots inferidos.',
  }, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
