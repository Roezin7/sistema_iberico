import { describe, expect, it } from 'vitest';
import { esConsumoFifoActivo, esReversionFifo, filtroConsumoFifoActivo } from './fuentes.js';

describe('regla única de consumo FIFO activo', () => {
  it.each(['venta_fifo_vivo_w64', 'venta_receta', 'venta_receta_historica'])('acepta %s', (fuente) => {
    expect(esConsumoFifoActivo({ fuente, cantidad: 1 })).toBe(true);
  });

  it.each(['reversion_venta_receta', 'reversion_fifo', 'ajuste_inventario'])('excluye %s del consumo de ventas', (fuente) => {
    expect(esConsumoFifoActivo({ fuente, cantidad: 1 })).toBe(false);
    expect(esReversionFifo({ fuente })).toBe(fuente.startsWith('reversion_'));
  });

  it('permite ajustes sólo cuando la consulta lo pide expresamente', () => {
    expect(esConsumoFifoActivo({ fuente: 'ajuste_inventario', cantidad: 1 }, { incluirAjustes: true })).toBe(true);
    const normal = filtroConsumoFifoActivo();
    const conAjustes = filtroConsumoFifoActivo({ incluirAjustes: true });
    expect(JSON.stringify(normal)).not.toContain('ajuste_inventario');
    expect(JSON.stringify(conAjustes)).toContain('ajuste_inventario');
  });

  it('rechaza cantidades no positivas, aunque la fuente sea válida', () => {
    expect(esConsumoFifoActivo({ fuente: 'venta_receta', cantidad: 0 })).toBe(false);
    expect(esConsumoFifoActivo({ fuente: 'venta_receta', cantidad: -1 })).toBe(false);
  });
});
