import { prisma } from './server/dist/db.js';
import { resumen } from './server/dist/finanzas/service.js';
const s = await resumen(1n, 66n);
const rows = s.conciliacion_inventario?.filas ?? [];
const relevant = rows.filter((r) => Math.abs(Number(r.diferencia_fifo_valor ?? 0)) >= 0.01 || r.incidencia_tipo !== 'sin_diferencia');
const byType = {};
for (const r of relevant) {
  const key = r.incidencia_tipo ?? 'sin_tipo';
  const item = byType[key] ?? { productos: 0, diferenciaValor: 0, diferenciaCantidad: 0 };
  item.productos += 1;
  item.diferenciaValor += Number(r.diferencia_fifo_valor ?? 0);
  item.diferenciaCantidad += Number(r.diferencia_cantidad ?? 0);
  byType[key] = item;
}
relevant.sort((a, b) => Math.abs(Number(b.diferencia_fifo_valor ?? 0)) - Math.abs(Number(a.diferencia_fifo_valor ?? 0)));
const top = relevant.slice(0, 30).map((r) => ({ productId: r.product_id, producto: r.producto, tipo: r.incidencia_tipo, incidencia: r.incidencia, apertura: r.inventario_inicial, compras: r.compras_recibidas, consumoTeorico: r.consumo_teorico, consumoFisicoInferido: r.consumo_fisico_inferido, esperado: r.existencia_fifo_esperada, fisico: r.inventario_fisico_final, diferenciaCantidad: r.diferencia_cantidad, diferenciaValor: r.diferencia_fifo_valor, costo: r.costo_fifo }));
const sumExpected = rows.reduce((a, r) => a + Number(r.existencia_fifo_esperada ?? 0) * Number(r.costo_fifo ?? 0), 0);
const sumPhysical = rows.reduce((a, r) => a + Number(r.inventario_fisico_final ?? 0) * Number(r.costo_fifo ?? 0), 0);
const sumFifoDiff = rows.reduce((a, r) => a + Number(r.diferencia_fifo_valor ?? 0), 0);
console.log(JSON.stringify({ total: { fifo: s.inventario?.valor_fifo_corte, fisico: s.inventario?.cierre_valor, diferencia: s.inventario?.diferencia_fifo_vs_fisico, aperturaHistorica: s.conciliacion_inventario?.diferencia_apertura_valor, semana: s.conciliacion_inventario?.diferencia_semana_valor, sumExpected, sumPhysical, sumFifoDiff, residualTopVsRows: Number(s.inventario?.diferencia_fifo_vs_fisico ?? 0) + sumFifoDiff }, byType, top }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
