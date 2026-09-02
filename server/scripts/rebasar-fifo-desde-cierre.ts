import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/db.js';
import { inventarioActual, valorSnapshot } from '../src/inventario/service.js';
import { persistirConciliacionInventarioSemana } from '../src/finanzas/service.js';

/**
 * Alinea el saldo FIFO operativo con el último cierre físico sin borrar
 * historial: sobrantes FIFO se consumen como ajuste y faltantes FIFO se
 * agregan como lotes de ajuste al costo base de catálogo.
 *
 * Dry-run por defecto. Ejecutar con --apply después de respaldar producción.
 */
const NEGOCIO = 1n;
const SEMANA = 65n;
const SEMANA_SIGUIENTE = 66n;
const USUARIO = 1n;
const MARKER = 'REBASE-FIFO-65-FISICO-2026-09-01';
const MOTIVO = 'Rebase FIFO al inventario físico del cierre de semana 65';

function round(n: number, digits = 4) {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function json(value: unknown) {
  return JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2);
}

async function main() {
  const aplicar = process.argv.includes('--apply');
  const [semana, siguiente, cierre, actual, productos, lotes, zonas, unidades] = await Promise.all([
    prisma.semanas.findFirst({ where: { id: SEMANA, negocio_id: NEGOCIO }, select: { id: true, fecha_inicio: true, fecha_fin: true, estado: true, inventario_semanal: true } }),
    prisma.semanas.findFirst({ where: { id: SEMANA_SIGUIENTE, negocio_id: NEGOCIO }, select: { id: true, estado: true, inventario_semanal: true } }),
    prisma.inventory_snapshot.findFirst({ where: { id: 60n, negocio_id: NEGOCIO }, include: { inventory_lines: true } }),
    inventarioActual(NEGOCIO, { vista: 'fisica' }),
    prisma.products.findMany({ where: { negocio_id: NEGOCIO, active: true }, select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true } }),
    prisma.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, estado: 'abierto', cantidad_restante: { gt: 0 } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }], select: { id: true, product_id: true, cantidad_restante: true, costo_unitario: true, fuente: true } }),
    prisma.zonas_inventario.findMany({ where: { negocio_id: NEGOCIO }, orderBy: { orden: 'asc' }, select: { id: true } }),
    prisma.product_zone_units.findMany({ where: { products: { negocio_id: NEGOCIO } }, select: { product_id: true, zona_id: true, factor: true } }),
  ]);
  // La comprobación de idempotencia va antes de validar los enlaces antiguos:
  // después de aplicar el rebase, semana 65/66 ya apuntan deliberadamente al
  // snapshot nuevo y una segunda ejecución debe ser un no-op seguro.
  const previo = await prisma.inventory_snapshot.findFirst({ where: { negocio_id: NEGOCIO, semana_id: SEMANA, motivo: MOTIVO } });
  if (previo) {
    console.log(json({ estado: 'ya_aplicado', snapshot_nuevo: Number(previo.id), marker: MARKER }));
    return;
  }
  if (!semana || !semana.inventario_semanal || semana.inventario_semanal.cierre_snapshot_id !== 60n) throw new Error('La semana 65 ya no apunta al cierre físico 60; se cancela para evitar alterar otro cierre.');
  if (!siguiente?.inventario_semanal || siguiente.inventario_semanal.apertura_snapshot_id !== 60n) throw new Error('La semana 66 ya no apunta al cierre 60; se cancela para evitar romper la cadena.');
  if (!cierre) throw new Error('No existe snapshot físico 60.');
  if (siguiente.estado === 'cerrada') throw new Error('La semana 66 está cerrada; no se rebalancea una apertura cerrada automáticamente.');
  const lotesPorProducto = new Map<string, { id: bigint; cantidad: number; costo: number; fuente: string }[]>();
  for (const l of lotes) {
    // El saldo histórico de prueba no debe entrar al FIFO operativo.
    if (l.fuente === 'historico_prueba') continue;
    const key = l.product_id.toString();
    const lista = lotesPorProducto.get(key) ?? [];
    lista.push({ id: l.id, cantidad: Number(l.cantidad_restante), costo: Number(l.costo_unitario), fuente: l.fuente });
    lotesPorProducto.set(key, lista);
  }
  const productoPorId = new Map(productos.map((p) => [p.id.toString(), p]));
  const unidadPorProducto = new Map(unidades.map((u) => [u.product_id.toString(), { zona_id: u.zona_id, factor: Number(u.factor) }]));
  const zonaPorDefecto = zonas[0]?.id ?? 1n;
  const lineaPorProducto = new Map<string, { zona_id: bigint; factor: number; qty_captura: number }>();
  for (const l of cierre.inventory_lines) {
    const key = l.product_id.toString();
    if (!lineaPorProducto.has(key)) lineaPorProducto.set(key, { zona_id: l.zona_id, factor: Number(l.factor), qty_captura: Number(l.qty_captura) });
  }

  const diferencias = actual.productos.map((p) => {
    const fifo = p.existencia_fifo_base ?? 0;
    const fisico = p.existencia_fisica_base;
    return { product_id: p.product_id, producto: p.nombre, fisico, fifo, delta: round(fisico - fifo), catalogo: p.unit_cost_base };
  }).filter((r) => Math.abs(r.delta) > 0.0001);
  const resumen = diferencias.map((r) => ({ ...r, valor_catalogo: r.catalogo == null ? null : round(r.delta * r.catalogo, 2) }));
  console.log(json({ modo: aplicar ? 'apply' : 'dry-run', snapshot_cierre: 60, productos_con_diferencia: resumen.length, positivos_fisico_mayor: resumen.filter((r) => r.delta > 0).length, negativos_fisico_menor: resumen.filter((r) => r.delta < 0).length, diferencia_total_unidades: round(resumen.reduce((a, r) => a + r.delta, 0)), diferencias: resumen.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20) }));
  if (!aplicar) return;

  const resultado = await prisma.$transaction(async (tx) => {
    const nuevo = await tx.inventory_snapshot.create({ data: {
      negocio_id: NEGOCIO, tipo: 'ajuste', semana_id: SEMANA, motivo: MOTIVO,
      nota: `Rebase autorizado: el físico es la fuente de verdad; FIFO queda como auditoría. Snapshot anterior 60. Marker ${MARKER}.`,
    } });
    await tx.inventory_lines.createMany({ data: cierre.inventory_lines.map((l) => ({
      snapshot_id: nuevo.id, product_id: l.product_id, zona_id: l.zona_id,
      qty_captura: Number(l.qty_captura), factor: Number(l.factor),
    })) });

    const ajustes: { product_id: bigint; zona_id: bigint; cantidad_base: number; factor: number; cantidad_captura: number; costo: number }[] = [];
    for (const d of diferencias) {
      const producto = productoPorId.get(String(d.product_id));
      const linea = lineaPorProducto.get(String(d.product_id));
      if (!producto) throw new Error(`Producto no encontrado ${d.product_id}`);
      const referencia = linea ?? (() => {
        const u = unidadPorProducto.get(String(d.product_id));
        return { zona_id: u?.zona_id ?? zonaPorDefecto, factor: u?.factor && u.factor > 0 ? u.factor : 1, qty_captura: 0 };
      })();
      const costoCatalogo = producto.unit_cost == null ? null : producto.unidad_base && producto.contenido_compra != null
        ? Number(producto.unit_cost) / Number(producto.contenido_compra)
        : Number(producto.unit_cost);
      const previos = lotesPorProducto.get(String(d.product_id)) ?? [];
      const costoPromedio = previos.length ? previos.reduce((a, l) => a + l.cantidad * l.costo, 0) / previos.reduce((a, l) => a + l.cantidad, 0) : null;
      const costo = d.delta > 0 ? (costoCatalogo ?? costoPromedio) : costoPromedio ?? costoCatalogo;
      if (costo == null || !Number.isFinite(costo)) throw new Error(`Sin costo base para ${d.producto}`);
      ajustes.push({ product_id: BigInt(d.product_id), zona_id: referencia.zona_id, cantidad_base: d.delta, factor: referencia.factor, cantidad_captura: round(d.delta / referencia.factor), costo: round(costo, 6) });
    }

    for (const a of ajustes) {
      const solicitud = `${MARKER}-${a.product_id}`;
      const row = await tx.inventory_adjustments.create({ data: {
        negocio_id: NEGOCIO, semana_id: SEMANA, product_id: a.product_id, zona_id: a.zona_id,
        cantidad_base: a.cantidad_base, factor: a.factor, cantidad_captura: a.cantidad_captura,
        costo_unitario: a.costo, motivo: MOTIVO, nota: `Ajuste automático auditable ${MARKER}.`, solicitud_id: solicitud,
        snapshot_anterior_id: 60n, snapshot_nuevo_id: nuevo.id, usuario_id: USUARIO,
      } });
      if (a.cantidad_base > 0) {
        await tx.inventory_lots.create({ data: {
          negocio_id: NEGOCIO, product_id: a.product_id, recibido_at: semana.fecha_fin,
          cantidad_inicial: a.cantidad_base, cantidad_restante: a.cantidad_base, costo_unitario: a.costo,
          fuente: 'ajuste_inventario', ticket_ref: `AJUSTE-INVENTARIO-${SEMANA}-REBASE-${row.id}`,
          notas: `Rebase contra físico cierre 65 (${MARKER}).`,
        } });
      } else {
        let pendiente = Math.abs(a.cantidad_base);
        const disponibles = await tx.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, product_id: a.product_id, estado: 'abierto', cantidad_restante: { gt: 0 }, fuente: { not: 'historico_prueba' } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }] });
        const total = disponibles.reduce((s, l) => s + Number(l.cantidad_restante), 0);
        if (total + 0.0001 < pendiente) throw new Error(`FIFO insuficiente para rebajar ${a.product_id}: faltan ${pendiente - total}`);
        for (const lote of disponibles) {
          if (pendiente <= 0) break;
          const cantidad = Math.min(pendiente, Number(lote.cantidad_restante));
          await tx.inventory_consumptions.create({ data: {
            negocio_id: NEGOCIO, product_id: a.product_id, lote_id: lote.id, fecha: semana.fecha_fin,
            cantidad, costo_unitario: Number(lote.costo_unitario), costo_total: cantidad * Number(lote.costo_unitario), fuente: 'ajuste_inventario',
          } });
          const restante = Number(lote.cantidad_restante) - cantidad;
          await tx.inventory_lots.update({ where: { id: lote.id }, data: { cantidad_restante: restante, estado: restante <= 0.0001 ? 'agotado' : 'abierto' } });
          pendiente = round(pendiente - cantidad);
        }
      }
    }
    const valor = await valorSnapshotTx(tx, nuevo.id);
    await tx.inventario_semanal.updateMany({ where: { negocio_id: NEGOCIO, semana_id: SEMANA }, data: { cierre_snapshot_id: nuevo.id, cierre_valor: valor } });
    await tx.inventario_semanal.updateMany({ where: { negocio_id: NEGOCIO, semana_id: SEMANA_SIGUIENTE, apertura_snapshot_id: 60n }, data: { apertura_snapshot_id: nuevo.id, apertura_valor: valor, apertura_origen: 'rebase_fifo_fisico_cierre_65' } });
    return { snapshot_nuevo: nuevo.id, ajustes: ajustes.length, valor_cierre: valor };
  }, { timeout: 120_000, maxWait: 15_000 });
  const conciliacion = await persistirConciliacionInventarioSemana(NEGOCIO, SEMANA);
  console.log(json({ estado: 'aplicado', ...resultado, conciliacion: { reporte_independiente: conciliacion.reporte_independiente, filas: conciliacion.filas?.length, diferencia_valor: conciliacion.total_diferencia_valor } }));
}

async function valorSnapshotTx(tx: Prisma.TransactionClient, snapshotId: bigint) {
  const lineas = await tx.inventory_lines.findMany({ where: { snapshot_id: snapshotId }, include: { products: { select: { unit_cost: true, unidad_base: true, contenido_compra: true } } } });
  return Math.round(lineas.reduce((s, l) => {
    const costo = l.products.unit_cost == null ? 0 : l.products.unidad_base && l.products.contenido_compra != null ? Number(l.products.unit_cost) / Number(l.products.contenido_compra) : Number(l.products.unit_cost);
    return s + Number(l.qty_captura) * Number(l.factor) * costo;
  }, 0) * 100) / 100;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
