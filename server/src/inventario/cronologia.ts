import { HttpError } from '../middleware/error.js';

export function instanteReal(value: string | Date | null | undefined, ahora = new Date()): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > ahora.getTime() + 60_000) throw new HttpError(400, 'La hora efectiva no puede ser inválida ni estar en el futuro');
  return date;
}

/** Referencia de día para legado, no hora real ni hora de captura. */
export function referenciaDiaMexico(fecha: Date): Date {
  return new Date(`${fecha.toISOString().slice(0, 10)}T00:00:00-06:00`);
}

export type AnclaZona = { zonaId: number; nombre: string; cantidad: number; corte: Date | null };
export type EventoFisico =
  | { tipo: 'entrada'; fecha: Date; cantidad: number; zonaId: number }
  | { tipo: 'venta'; fecha: Date; cantidad: number }
  | { tipo: 'salida'; fecha: Date; cantidad: number; zonaId: number }
  | { tipo: 'transferencia'; fecha: Date; cantidad: number; origen: number; destino: number };

/** Libro físico por zona. Los cortes son independientes y las ventas salen de
 * Local. El respaldo a otras zonas es teórico y sólo opera después de sus cortes.
 * Si Local se contó después de una venta, esa venta ya está incluida en su físico:
 * nunca debe volver a debitar Bodega sólo porque Bodega se contó primero.
 */
export function reconstruirZonas(anclas: AnclaZona[], eventos: EventoFisico[]) {
  const saldos = new Map(anclas.map(a => [a.zonaId, a.cantidad]));
  const local = anclas.find(a => a.nombre.trim().toLowerCase() === 'local');
  const orden = [...anclas].sort((a, b) => (a.zonaId === local?.zonaId ? -1 : b.zonaId === local?.zonaId ? 1 : a.nombre.localeCompare(b.nombre)));
  const posterior = (id: number, date: Date) => { const a = anclas.find(a => a.zonaId === id); return !!a && (!a.corte || date > a.corte); };
  let entradas = 0; let consumos = 0; let noCubierto = 0; let trasladoNeto = 0;
  const prioridad = (e: EventoFisico) => e.tipo === 'entrada' ? 0 : e.tipo === 'transferencia' ? 1 : 2;
  for (const e of [...eventos].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || prioridad(a) - prioridad(b))) {
    if (!(e.cantidad > 0) || !Number.isFinite(e.cantidad)) continue;
    if (e.tipo === 'entrada') {
      if (posterior(e.zonaId, e.fecha)) { saldos.set(e.zonaId, (saldos.get(e.zonaId) ?? 0) + e.cantidad); entradas += e.cantidad; }
    } else if (e.tipo === 'transferencia') {
      const sale = posterior(e.origen, e.fecha), entra = posterior(e.destino, e.fecha);
      // Si ambos lados necesitan reconstrucción, no crear saldo en destino
      // que nunca estuvo disponible en origen. Con cortes cruzados cada lado
      // sigue siendo independiente: el otro ya está contenido en su conteo.
      const cantidad = sale && entra ? Math.min(e.cantidad, Math.max(0, saldos.get(e.origen) ?? 0)) : e.cantidad;
      if (sale && entra) noCubierto += e.cantidad - cantidad;
      if (sale) { saldos.set(e.origen, (saldos.get(e.origen) ?? 0) - cantidad); trasladoNeto -= cantidad; }
      if (entra) { saldos.set(e.destino, (saldos.get(e.destino) ?? 0) + cantidad); trasladoNeto += cantidad; }
    } else {
      if (e.tipo === 'venta' && local?.corte && e.fecha <= local.corte) continue;
      const candidatas = e.tipo === 'salida' ? orden.filter(a => a.zonaId === e.zonaId) : orden;
      if (!candidatas.some(a => posterior(a.zonaId, e.fecha))) continue;
      let pendiente = e.cantidad;
      for (const a of candidatas) {
        if (!posterior(a.zonaId, e.fecha)) continue;
        const toma = Math.min(pendiente, Math.max(0, saldos.get(a.zonaId) ?? 0));
        saldos.set(a.zonaId, (saldos.get(a.zonaId) ?? 0) - toma); pendiente -= toma;
      }
      consumos += e.cantidad; noCubierto += pendiente;
    }
  }
  for (const [id, saldo] of saldos) saldos.set(id, Math.max(0, Math.round(saldo * 1e6) / 1e6));
  return { saldos, total: [...saldos.values()].reduce((s, v) => s + v, 0), entradas, consumos, noCubierto, trasladoNeto };
}
