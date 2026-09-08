import { prisma } from './server/dist/db.js';
import { resumen, saludOperativa, listarExcepcionesCosteoSemana } from './server/dist/finanzas/service.js';
const s = await resumen(1n, 66n);
const h = await saludOperativa(1n);
const e = await listarExcepcionesCosteoSemana(1n, 66n);
console.log(JSON.stringify({ estado: s.estado, ventas: s.ventas, inventario: s.inventario && { apertura: s.inventario.apertura_valor, cierre: s.inventario.cierre_valor, fifo: s.inventario.valor_fifo_corte, diferencia: s.inventario.diferencia_fifo_vs_fisico, costoVentas: s.inventario.costo_ventas }, pendientes: s.ventas_epos_pendientes, excepciones: e, salud: h }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
