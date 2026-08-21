import { PrismaClient } from '@prisma/client';
import { prepararAperturaFifo } from '../src/inventario/apertura-fifo.js';
import { consumirVentasEpos } from '../src/inventario/consumo-epos.js';

/**
 * Reconstrucción idempotente de los cuatro tickets que ya existían como
 * movimientos financieros de la semana 63. No crea movimientos nuevos y no
 * toca lotes, ventas ni inventario de la semana 64.
 */

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const SEMANA = 63n;
const FROM = '2026-08-10T00:00:00.000Z';
const TO = '2026-08-17T00:00:00.000Z';

type Line = {
  productId?: bigint;
  descripcion: string;
  tipo: 'inventario' | 'gasto' | 'pendiente';
  cantidad?: number;
  unidad?: string;
  contenido?: number;
  importe: number;
  nota?: string;
};

type Ticket = {
  ref: string;
  proveedor: string;
  total: number;
  movimientoIds: bigint[];
  lineas: Line[];
};

const inventory = (productId: number, descripcion: string, cantidad: number, unidad: string, contenido: number, importe: number, nota?: string): Line => ({ productId: BigInt(productId), descripcion, tipo: 'inventario', cantidad, unidad, contenido, importe, nota });
const pending = (descripcion: string, importe: number, nota: string): Line => ({ descripcion, tipo: 'pendiente', importe, nota });
const gasto = (descripcion: string, importe: number, nota: string): Line => ({ descripcion, tipo: 'gasto', importe, nota });

const TICKETS: Ticket[] = [
  {
    ref: 'HIST-63-BODEGAS-BC20262186',
    proveedor: 'Bodegas Alameda',
    total: 2922,
    movimientoIds: [1100n],
    lineas: [
      inventory(19, 'Tequila Cuervo 1800 Añejo Cristalino 700 ml', 700, 'botella', 700, 779),
      inventory(2, 'Mezcal 400 Conejos Joven Espadín 700 ml', 700, 'botella', 700, 525),
      inventory(10, 'Campari 750 ml', 750, 'botella', 750, 465),
      inventory(79, 'Tequila Ocho Plata 750 ml', 750, 'botella', 750, 559),
      inventory(14, 'Gibsons London 1000 ml', 2000, 'botella', 1000, 594),
    ],
  },
  {
    ref: 'HIST-63-COSTCO-20260811',
    proveedor: 'Costco',
    total: 3320,
    movimientoIds: [1101n, 1123n],
    lineas: [
      inventory(44, 'Jamón prosciutto Daniele 340 g (sustituto de jamón serrano)', 1700, 'paquete', 340, 1017.85, '5 paquetes; descuento del ticket no asignado a la línea de inventario'),
      inventory(67, 'Tocino Kirkland 567 g', 2835, 'bolsa', 567, 915.55, '5 bolsas; descuento del ticket no asignado a la línea de inventario'),
      inventory(41, 'Mezcla frutos rojos orgánica 1.81 kg', 5430, 'bolsa congelada', 1810, 764.16, '3 bolsas; descuento del ticket no asignado a la línea de inventario'),
      gasto('Higiénico, toalla interdoblada e insecticida Costco', 622.44, 'Importe no inventariable ya registrado en el movimiento 1123; incluye el ajuste de descuento del ticket.'),
    ],
  },
  {
    ref: 'HIST-63-LACOMER-23933753',
    proveedor: 'La Comer',
    total: 1546.5,
    movimientoIds: [1102n],
    lineas: [
      inventory(29, 'Volt 400 ml', 2400, 'paquete', 400, 55.6, '6 unidades compradas; 2 unidades gratis. Se conserva la cantidad física de 6.'),
      inventory(45, 'Salchichón Conde de', 1000, 'pieza', 500, 181),
      inventory(50, 'Romero', 40, 'paquete', 20, 59.8, '2 paquetes; 20 ramas útiles por paquete.'),
      inventory(49, 'Albahaca verde', 20, 'paquete', 20, 29.9, '1 paquete.'),
      inventory(46, 'Chorizo Conde de', 500, 'pieza', 500, 90.5),
      pending('Queso Winter Park H…', 98.5, 'Producto visible en el ticket, sin relación confirmada en el catálogo; no crear lote hasta identificarlo.'),
      pending('Untable Philadelphia', 40, 'Presentación en gramos no confirmada; no crear lote hasta confirmar el contenido.'),
      inventory(51, 'Hierbabuena', 30, 'manojo', 30, 29.9, '1 manojo; el rendimiento útil se mantiene pendiente de validación.'),
      inventory(59, 'Salsa Prego 680 g', 2720, 'paquete', 680, 356, '4 envases.'),
      inventory(25, 'Squirt 1 L', 4000, 'paquete', 1000, 92, '4 botellas.'),
      inventory(80, 'Fanta 600 ml', 2400, 'paquete', 600, 84.4, '4 botellas.'),
      inventory(47, 'Pan de cebolla', 600, 'paquete', 200, 82.5, 'La línea representa 3 piezas; 200 g por pieza.'),
      inventory(70, 'Salsa Heinz 567 g', 1134, 'paquete', 567, 82, '2 envases.'),
      inventory(23, 'Jarabe La Madrileña', 700, 'botella', 700, 91.7),
      inventory(33, 'Agua Schweppes/Tónica 296 ml', 1776, 'paquete', 1776, 108.7, '1 paquete de 6 × 296 ml.'),
      inventory(24, 'Sprite 1.7 L', 3400, 'paquete', 1700, 64, '2 botellas.'),
    ],
  },
  {
    ref: 'HIST-63-LACOMER-ARUGULA-20260811',
    proveedor: 'La Comer',
    total: 137.2,
    movimientoIds: [1103n],
    lineas: [pending('Arúgula Baby Daily', 137.2, 'La presentación y el rendimiento útil no están confirmados; no crear lote todavía.')],
  },
];

function asMoney(n: number) { return Number(n.toFixed(4)); }
function sum(lines: Line[]) { return asMoney(lines.reduce((a, l) => a + l.importe, 0)); }

async function main() {
  const eposIds = (await prisma.epos_ventas.findMany({ where: { negocio_id: NEGOCIO, fecha: { gte: new Date(FROM), lt: new Date(TO) } }, select: { id: true } })).map((v) => v.id);
  const activeLotsBefore = await prisma.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, fuente: 'inventario_inicial' }, select: { id: true, cantidad_restante: true } });
  const activeSignature = JSON.stringify(activeLotsBefore.map((l) => [l.id.toString(), Number(l.cantidad_restante)]));

  const existing = await prisma.purchases.findMany({ where: { negocio_id: NEGOCIO, ticket_ref: { in: TICKETS.map((t) => t.ref) } }, select: { ticket_ref: true } });
  if (existing.length) throw new Error(`La reconstrucción ya existe: ${existing.map((x) => x.ticket_ref).join(', ')}`);

  for (const ticket of TICKETS) {
    if (sum(ticket.lineas) !== ticket.total) throw new Error(`${ticket.ref} no cuadra: ${sum(ticket.lineas)} != ${ticket.total}`);
  }

  await prisma.$transaction(async (tx) => {
    const movimientos = await tx.movimientos.findMany({ where: { id: { in: TICKETS.flatMap((t) => t.movimientoIds) }, negocio_id: NEGOCIO, semana_id: SEMANA }, select: { id: true, monto: true, compra_id: true, usuario_id: true } });
    if (movimientos.length !== TICKETS.flatMap((t) => t.movimientoIds).length) throw new Error('Falta un movimiento financiero esperado de la semana 63');
    if (movimientos.some((m) => m.compra_id != null)) throw new Error('Un movimiento financiero ya está enlazado a otra compra');

    // Rehacer sólo la isla histórica de semana 63. No toca lotes normales.
    if (eposIds.length) {
      await tx.inventory_consumptions.deleteMany({ where: { negocio_id: NEGOCIO, epos_venta_id: { in: eposIds }, fuente: 'venta_receta_historica' } });
      await tx.epos_ventas.updateMany({ where: { negocio_id: NEGOCIO, id: { in: eposIds } }, data: { costo_fifo: null, costeo_estado: 'pendiente', costeo_error: null, costeado_at: null } });
    }
    const lotesHistoricos = await tx.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, fuente: 'historico_prueba', OR: [{ ticket_ref: 'APERTURA-FIFO-HISTORICO-63' }, { ticket_ref: 'AJUSTE-FALTANTES-63' }, { ticket_ref: { startsWith: 'HIST-63-' } }] }, select: { id: true } });
    if (lotesHistoricos.length) {
      // La FK de consumos es RESTRICT: hay que retirar primero cualquier
      // consumo de la isla histórica, incluidos los que no estén asociados
      // a una venta actualmente seleccionada.
      await tx.inventory_consumptions.deleteMany({ where: { negocio_id: NEGOCIO, lote_id: { in: lotesHistoricos.map((l) => l.id) } } });
      await tx.inventory_lots.deleteMany({ where: { id: { in: lotesHistoricos.map((l) => l.id) } } });
    }

    for (const ticket of TICKETS) {
      const movimiento = movimientos.find((m) => ticket.movimientoIds.includes(m.id));
      const compra = await tx.purchases.create({ data: { negocio_id: NEGOCIO, fecha_recepcion: new Date('2026-08-11T00:00:00.000Z'), proveedor: ticket.proveedor, ticket_ref: ticket.ref, total: ticket.total, moneda: 'MXN', fuente: 'historico_reconstruccion', estado: 'confirmada', notas: 'Reconstrucción histórica desde tickets ya documentados; no crear movimientos duplicados.', confirmada_por: movimiento?.usuario_id ?? null, confirmada_at: new Date() } });
      const mapped = ticket.lineas.filter((l): l is Line & { productId: bigint; cantidad: number; unidad: string; contenido: number } => l.tipo === 'inventario' && l.productId != null && l.cantidad != null && l.unidad != null && l.contenido != null);
      for (const line of mapped) {
        await tx.purchase_lines.create({ data: { purchase_id: compra.id, product_id: line.productId, qty: line.cantidad, unidad_compra: line.unidad, contenido_compra: line.contenido, costo_unitario: line.importe / line.cantidad, importe: line.importe } });
        await tx.inventory_lots.create({ data: { negocio_id: NEGOCIO, product_id: line.productId, purchase_id: compra.id, recibido_at: new Date('2026-08-11T00:00:00.000Z'), cantidad_inicial: line.cantidad, cantidad_restante: line.cantidad, costo_unitario: line.importe / line.cantidad, moneda: 'MXN', fuente: 'historico_prueba', ticket_ref: ticket.ref, notas: line.nota ?? 'Compra histórica del 11 de agosto.' } });
      }
      await tx.purchase_capture_lines.createMany({ data: ticket.lineas.map((line) => ({ purchase_id: compra.id, product_id: line.productId ?? null, tipo_linea: line.tipo, descripcion_fuente: line.descripcion, cantidad_base: line.cantidad ?? null, unidad_compra: line.unidad ?? null, contenido_compra: line.contenido ?? null, costo_unitario: line.cantidad ? line.importe / line.cantidad : null, importe: line.importe, confianza: line.tipo === 'pendiente' ? 0.5 : 1, notas: line.nota ?? null })) });
      await tx.movimientos.updateMany({ where: { id: { in: ticket.movimientoIds }, negocio_id: NEGOCIO, semana_id: SEMANA }, data: { compra_id: compra.id } });
    }
  }, { timeout: 60_000 });

  await prepararAperturaFifo({ negocioId: NEGOCIO, semanaId: SEMANA, criterio: 'catalogo', modo: 'historico_prueba' });
  const resultado = await consumirVentasEpos({ negocioId: NEGOCIO, from: FROM, to: TO, confirmar: true, modo: 'historico_prueba' });
  const activeLotsAfter = await prisma.inventory_lots.findMany({ where: { negocio_id: NEGOCIO, fuente: 'inventario_inicial' }, select: { id: true, cantidad_restante: true } });
  const activeSignatureAfter = JSON.stringify(activeLotsAfter.map((l) => [l.id.toString(), Number(l.cantidad_restante)]));
  if (activeSignature !== activeSignatureAfter) throw new Error('La prueba alteró lotes de la semana 64');

  const [excepciones, confirmadas] = await Promise.all([
    prisma.epos_ventas.findMany({ where: { negocio_id: NEGOCIO, fecha: { gte: new Date(FROM), lt: new Date(TO) }, costeo_estado: 'excepcion' }, select: { producto_nombre: true, costeo_error: true } }),
    prisma.epos_ventas.count({ where: { negocio_id: NEGOCIO, fecha: { gte: new Date(FROM), lt: new Date(TO) }, costeo_estado: 'costeada' } }),
  ]);
  console.log(JSON.stringify({ ok: true, resultado, confirmadas, excepciones: excepciones.length, detalle_excepciones: excepciones, semana64_intacta: true }, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
