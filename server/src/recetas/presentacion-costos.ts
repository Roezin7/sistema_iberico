export interface CostosMenuVisibles {
  precio_venta: number | null; costo_fifo_actual: number | null;
  costo_fifo_referencia: number | null; costo_receta: number | null;
}
/** Tarjeta, desglose y promedios deben usar la misma fuente completa. */
export function costoVisibleMenu(p: CostosMenuVisibles) {
  const fuente = p.costo_fifo_actual != null ? 'fifo_actual' : p.costo_fifo_referencia != null ? 'fifo_referencia' : p.costo_receta != null ? 'catalogo' : 'pendiente';
  const costo = fuente === 'fifo_actual' ? p.costo_fifo_actual : fuente === 'fifo_referencia' ? p.costo_fifo_referencia : p.costo_receta;
  return { fuente, costo, margen: costo != null && p.precio_venta != null ? p.precio_venta - costo : null,
    foodCost: costo != null && p.precio_venta != null && p.precio_venta > 0 ? costo / p.precio_venta * 100 : null };
}
