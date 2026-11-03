import { prisma } from '../db.js';
import { fechaMexico, q4 } from './libro-fisico.js';

/** Sólo costos sin venta. Producción capitaliza ingredientes; clasificaciones
 * Epos ya forman parte de costo de ventas y nunca se descuentan dos veces. */
export async function costosSinVenta(negocioId: bigint, semanaId?: bigint) {
  const [operaciones, casos, semanas] = await Promise.all([
    prisma.inventory_operations.findMany({ where: { negocio_id: negocioId, ...(semanaId ? { semana_id: semanaId } : {}), epos_venta_id: null, tipo: { not: 'produccion' } } }),
    prisma.inventory_variance_cases.findMany({ where: { negocio_id: negocioId, ...(semanaId ? { semana_id: semanaId } : {}), origen: 'semanal', diferencia: { lt: 0 } } }),
    prisma.semanas.findMany({ where: { negocio_id: negocioId, ...(semanaId ? { id: semanaId } : {}) }, select: { id: true, fecha_fin: true } }),
  ]);
  const lineas = operaciones.length ? await prisma.inventory_operation_lines.findMany({ where: { operacion_id: { in: operaciones.map(o=>o.id) }, cantidad: { lt: 0 } } }) : [];
  const porMes: Record<string, number> = {};
  const porTipo: Record<string, number> = {};
  const porSemana: Record<string,number> = {};
  let pendientes = 0, estimados = 0, conocidas = 0, diferencias = 0;
  const agregar = (mes: string, tipo: string, costo: number) => { porMes[mes]=q4((porMes[mes]??0)+costo); porTipo[tipo]=q4((porTipo[tipo]??0)+costo); };
  for (const o of operaciones) for (const l of lineas.filter(l=>l.operacion_id===o.id)) {
    const costo = Number(l.costo_total ?? 0); conocidas += costo;
    porSemana[String(o.semana_id)]=(porSemana[String(o.semana_id)]??0)+costo;
    agregar(fechaMexico(o.efectiva_at).slice(0,7), o.tipo, costo);
    if (Number(l.pendiente_cantidad)>0 || l.costo_total==null) pendientes++;
    if (l.costo_estimado) estimados++;
  }
  for (const c of casos) {
    // Un error de dato no es merma demostrada. El resultado sigue provisional
    // hasta corregirlo con evidencia; no se convierte en un gasto de Caja.
    if (['error_conteo','error_presentacion','compra_omitida','venta_omitida','receta'].includes(c.causa)) { pendientes++; continue; }
    if (c.costo_unitario == null) { pendientes++; continue; }
    const costo = Math.abs(Number(c.diferencia))*Number(c.costo_unitario); diferencias += costo;
    porSemana[String(c.semana_id)]=(porSemana[String(c.semana_id)]??0)+costo;
    const mes=semanas.find(s=>s.id===c.semana_id)?.fecha_fin.toISOString().slice(0,7);
    if(mes) agregar(mes, c.causa==='sin_explicar'?'faltante_por_explicar':c.causa, costo);
    if(c.costo_estimado || c.causa==='sin_explicar') estimados++;
  }
  return { total:q4(conocidas+diferencias), salidas_registradas:q4(conocidas), diferencias_semanales:q4(diferencias), por_tipo:porTipo, por_mes:porMes, por_semana:porSemana, pendientes, estimados, sin_movimiento_de_caja:true };
}
