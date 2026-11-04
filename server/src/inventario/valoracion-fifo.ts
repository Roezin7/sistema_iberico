/** Una sola valoración: cantidades de las capas × sus costos almacenados.
 * Nunca sustituir por catálogo, ni siquiera cuando los costos casi coinciden.
 * Redondear para mostrar sólo después de sumar todas las capas. */
export function resumirValoracionFifo(lotes: {
  product_id: bigint | number;
  cantidad_restante: unknown;
  costo_unitario: unknown;
  costo_estimado?: boolean;
}[]) {
  const productos = new Map<number, { product_id: number; cantidad: number; valor: number; capas_estimadas: number; valor_estimado: number }>();
  let valor = 0, unidades = 0, capas = 0, capasEstimadas = 0, valorEstimado = 0;
  for (const lote of lotes) {
    const cantidad = Number(lote.cantidad_restante), costo = Number(lote.costo_unitario);
    if (cantidad <= 0.0001) continue;
    if (!Number.isFinite(cantidad) || !Number.isFinite(costo) || costo < 0) throw new Error('Capa FIFO inválida para valoración');
    const importe = cantidad * costo;
    valor += importe; unidades += cantidad; capas++;
    const p = productos.get(Number(lote.product_id)) ?? { product_id: Number(lote.product_id), cantidad: 0, valor: 0, capas_estimadas: 0, valor_estimado: 0 };
    p.cantidad += cantidad; p.valor += importe;
    if (lote.costo_estimado) { capasEstimadas++; valorEstimado += importe; p.capas_estimadas++; p.valor_estimado += importe; }
    productos.set(p.product_id, p);
  }
  return {
    valor: Number(valor.toFixed(4)), valor_monetario: Number(valor.toFixed(2)),
    unidades: Number(unidades.toFixed(4)), lotes: capas,
    capas_estimadas: capasEstimadas, valor_estimado: Number(valorEstimado.toFixed(2)),
    provisional: capasEstimadas > 0,
    productos: [...productos.values()],
  };
}
