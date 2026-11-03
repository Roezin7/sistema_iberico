import type { Prisma, PrismaClient } from '@prisma/client';
import { convertirCantidad } from '../recetas/costeo.js';
import { normalizarNombreEpos } from '../epos/mapeo-menu.js';
import { esConsumoFifoActivo } from './fuentes.js';
import { referenciaDiaMexico, reconstruirZonas, type AnclaZona, type EventoFisico } from './cronologia.js';

export type DbInventario = Prisma.TransactionClient | PrismaClient;
export type EventoLibro = EventoFisico & { product_id: bigint; referencia: string; incluido_snapshot_id?: bigint };
export const fechaMexico = (fecha: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
export const diaDb = (fecha: Date) => new Date(`${fechaMexico(fecha)}T00:00:00Z`);
export const q4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export const efectivaLote = (l: { disponible_desde?: Date | null; recibido_at: Date; purchases?: { recibida_at: Date | null } | null }) => l.disponible_desde ?? l.purchases?.recibida_at ?? referenciaDiaMexico(l.recibido_at);
export const ordenLote = (l: { orden_fifo_at?: Date | null; recibido_at: Date; purchases?: { recibida_at: Date | null } | null }) => l.orden_fifo_at ?? l.purchases?.recibida_at ?? referenciaDiaMexico(l.recibido_at);

/** Cantidades físicas independientes de que la venta tenga costo asignado.
 * Comparación, existencia actual y cierre usan exactamente este libro. */
export async function cargarLibroFisico(db: DbInventario, negocioId: bigint, hasta: Date, desde?: Date) {
  const [zonas, ventas, menus, lotes, consumos, ajustes, operaciones] = await Promise.all([
    db.zonas_inventario.findMany({ where: { negocio_id: negocioId }, orderBy: { orden: 'asc' } }),
    db.epos_ventas.findMany({ where: { negocio_id: negocioId, fecha: { lte: hasta, ...(desde ? { gte: desde } : {}) } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] }),
    db.productos_menu.findMany({ where: { negocio_id: negocioId, activo: true }, include: { recetas: { where: { estado: 'validada' }, orderBy: { version: 'desc' }, include: { lineas: { include: { products: { select: { unidad_base: true } } } } } } } }),
    db.inventory_lots.findMany({ where: { negocio_id: negocioId, estado: { not: 'cancelado' } }, include: { purchases: { select: { recibida_at: true } }, transferencias: { orderBy: [{ fecha: 'asc' }, { id: 'asc' }] } } }),
    db.inventory_consumptions.findMany({ where: { negocio_id: negocioId, cantidad: { gt: 0 } }, include: { epos_venta: { select: { fecha: true } }, lote: { select: { zona_id: true } } } }),
    db.inventory_adjustments.findMany({ where: { negocio_id: negocioId } }),
    db.inventory_operations.findMany({ where: { negocio_id: negocioId, efectiva_at: { lte: hasta } } }),
  ]);
  const eventos: EventoLibro[] = [];
  const errores: { referencia: string; mensaje: string }[] = [];
  const bodega = zonas.find(z => z.nombre.trim().toLowerCase() === 'bodega')?.id;
  const push = (e: EventoLibro) => { if (e.fecha <= hasta && (!desde || e.fecha >= desde)) eventos.push(e); };
  const porId = new Map(menus.filter(m => (m.epos_product_id ?? 0) > 0).map(m => [m.epos_product_id!, m]));
  const porNombre = new Map(menus.map(m => [normalizarNombreEpos(m.nombre), m]));
  const cubiertas = new Set<string>();
  for (const venta of ventas) {
    if (!(Number(venta.cantidad) > 0)) { errores.push({ referencia: `venta:${venta.id}`, mensaje: 'Cantidad devuelta/cancelada requiere revisión; no se inventó una entrada física' }); continue; }
    const menu = ((venta.epos_product_id ?? 0) > 0 ? porId.get(venta.epos_product_id!) : null) ?? porNombre.get(normalizarNombreEpos(venta.producto_nombre));
    const receta = menu?.recetas.find(r => !r.vigente_desde || r.vigente_desde.toISOString().slice(0, 10) <= fechaMexico(venta.fecha));
    if (!receta?.lineas.length) { errores.push({ referencia: `venta:${venta.id}`, mensaje: `Sin receta histórica: ${venta.producto_nombre}` }); continue; }
    for (const l of receta.lineas) {
      const cantidad = l.products.unidad_base ? convertirCantidad(Number(l.cantidad) * Number(venta.cantidad), l.unidad, l.products.unidad_base) : null;
      if (cantidad == null || cantidad < 0) { errores.push({ referencia: `venta:${venta.id}`, mensaje: `Conversión pendiente: ${venta.producto_nombre}` }); continue; }
      cubiertas.add(`${venta.id}:${l.product_id}`);
      push({ tipo: 'venta', product_id: l.product_id, referencia: `venta:${venta.id}`, fecha: venta.fecha, cantidad });
    }
  }
  for (const c of consumos) {
    if (c.epos_venta_id && esConsumoFifoActivo(c) && !cubiertas.has(`${c.epos_venta_id}:${c.product_id}`)) {
      push({ tipo: 'venta', product_id: c.product_id, referencia: `consumo:${c.id}`, fecha: c.epos_venta?.fecha ?? c.efectiva_at ?? referenciaDiaMexico(c.fecha), cantidad: Number(c.cantidad) });
    } else if (!c.epos_venta_id && c.fuente === 'ajuste_inventario') {
      const ajuste = ajustes.find(a => a.product_id === c.product_id && Math.abs(a.creado_at.getTime() - c.creado_at.getTime()) < 10_000);
      const zona = ajuste?.zona_id ?? c.lote.zona_id ?? bodega;
      if (zona) push({ tipo: 'salida', product_id: c.product_id, referencia: `ajuste:${c.id}`, fecha: c.efectiva_at ?? referenciaDiaMexico(c.fecha), cantidad: Number(c.cantidad), zonaId: Number(zona), incluido_snapshot_id: ajuste?.snapshot_nuevo_id });
    }
  }
  for (const l of lotes) {
    for (const t of l.transferencias) {
      const origen = t.zona_origen_id ?? bodega;
      if (origen) push({ tipo: 'transferencia', product_id: l.product_id, referencia: `traslado:${t.id}`, fecha: t.efectiva_at ?? referenciaDiaMexico(t.fecha), cantidad: Number(t.cantidad), origen: Number(origen), destino: Number(t.zona_destino_id) });
    }
    if ((!l.purchase_id && !['ajuste_inventario', 'produccion_interna'].includes(l.fuente)) || l.operacion_linea_id) continue;
    const zona = l.transferencias[0]?.zona_origen_id ?? l.zona_id ?? bodega;
    const ajuste = l.fuente === 'ajuste_inventario' ? ajustes.find(a => a.product_id === l.product_id && Math.abs(a.creado_at.getTime() - l.creado_at.getTime()) < 10_000) : null;
    if (zona) push({ tipo: 'entrada', product_id: l.product_id, referencia: `lote:${l.id}`, fecha: efectivaLote(l), cantidad: Number(l.cantidad_inicial), zonaId: Number(zona), incluido_snapshot_id: ajuste?.snapshot_nuevo_id });
  }
  const ids = operaciones.map(o => o.id);
  const lineas = ids.length ? await db.inventory_operation_lines.findMany({ where: { operacion_id: { in: ids } } }) : [];
  const opMap = new Map(operaciones.map(o => [o.id.toString(), o]));
  for (const l of lineas) {
    const op = opMap.get(l.operacion_id.toString())!;
    if (op.epos_venta_id) continue; // sólo clasifica una salida que Epos ya consumió
    const cantidad = Number(l.cantidad);
    push({ tipo: cantidad > 0 ? 'entrada' : 'salida', fecha: op.efectiva_at, product_id: l.product_id, referencia: `operacion:${op.id}`, cantidad: Math.abs(cantidad), zonaId: Number(l.zona_id) });
  }
  return { zonas, eventos, errores, ventas, lotes, operaciones, lineas };
}

export function proyectarProducto(anclas: AnclaZona[], eventos: EventoLibro[], productId: bigint, hasta: Date, incluidos: Set<bigint> = new Set()) {
  return reconstruirZonas(anclas, eventos.filter(e => e.product_id === productId && e.fecha <= hasta && (!e.incluido_snapshot_id || !incluidos.has(e.incluido_snapshot_id))));
}
