import { describe, expect, it } from 'vitest';
import { consumirFIFO } from './fifo.js';

describe('consumirFIFO', () => {
  it('consume primero el lote más antiguo y cruza al siguiente', () => {
    const resultado = consumirFIFO([
      { id: 2, recibidoAt: '2026-08-12', cantidadRestante: 4, costoUnitario: 12 },
      { id: 1, recibidoAt: '2026-08-10', cantidadRestante: 3, costoUnitario: 10 },
    ], 5);

    expect(resultado.consumos).toEqual([
      { loteId: 1, cantidad: 3, costoUnitario: 10, costoTotal: 30 },
      { loteId: 2, cantidad: 2, costoUnitario: 12, costoTotal: 24 },
    ]);
    expect(resultado.cantidadConsumida).toBe(5);
    expect(resultado.faltante).toBe(0);
    expect(resultado.costoTotal).toBe(54);
  });

  it('conserva un faltante explícito cuando no existe suficiente inventario', () => {
    const resultado = consumirFIFO([
      { id: 1, recibidoAt: '2026-08-10', cantidadRestante: 2, costoUnitario: 10 },
    ], 5);

    expect(resultado.cantidadConsumida).toBe(2);
    expect(resultado.faltante).toBe(3);
    expect(resultado.costoTotal).toBe(20);
  });

  it('ignora lotes agotados y no modifica la entrada original', () => {
    const lotes = [{ id: 1, recibidoAt: '2026-08-10', cantidadRestante: 0, costoUnitario: 10 }];
    const resultado = consumirFIFO(lotes, 1);
    expect(resultado.consumos).toEqual([]);
    expect(resultado.faltante).toBe(1);
    expect(lotes[0]?.cantidadRestante).toBe(0);
  });
});
