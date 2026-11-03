import { q4 } from './libro-fisico.js';
export type CapaCierre = { id: bigint; cantidad: number; reservado: number; costo: number; orden: Date };
/** Sólo la diferencia del corte ajusta cantidades. Las capas supervivientes
 * conservan precio y antigüedad. Consumos posteriores ya registrados se
 * reservan para no reescribir sus cantidades ni costos. */
export function conciliarCapas(capas: CapaCierre[], fisico: number) {
  if (!Number.isFinite(fisico) || fisico < 0) throw new Error('Conteo inválido');
  const orden = [...capas].sort((a, b) => a.orden.getTime() - b.orden.getTime() || Number(a.id - b.id));
  if (orden.some(c => c.cantidad < -0.0001 || c.reservado < 0 || c.reservado > c.cantidad + 0.0001)) throw new Error('Libro de lotes inconsistente');
  const saldo = q4(orden.reduce((s, c) => s + c.cantidad, 0));
  if (q4(orden.reduce((s, c) => s + c.reservado, 0)) > fisico + 0.0001) throw new Error('El conteo no cubre consumos posteriores ya registrados; revisa conteo y cronología');
  let falta = Math.max(0, q4(saldo - fisico));
  const detalle = orden.map(c => {
    const ajuste = Math.min(falta, Math.max(0, q4(c.cantidad - c.reservado)));
    falta = q4(falta - ajuste);
    return { ...c, ajuste: q4(ajuste), conservar: q4(c.cantidad - ajuste) };
  });
  if (falta > 0.0001) throw new Error('No se pudo conservar la trazabilidad de consumos posteriores');
  return { saldo, diferencia: q4(fisico - saldo), sobrante: Math.max(0, q4(fisico - saldo)), detalle };
}
