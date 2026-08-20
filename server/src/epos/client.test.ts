import { describe, expect, it } from 'vitest';
import { buildReconcilePreview, summarizeBookkeeping, summarizeDailySales } from './client.js';

describe('puente Epos', () => {
  it('resume ventas por producto, método y día', () => {
    const bookkeeping = summarizeBookkeeping([
      { Product: 'Mojito', ProductID: 10, Quantity: 2, TotalSales: 150, Tender: 'Cash', TransactionID: 1, DateTime: '2026-08-21T20:00:00-06:00' },
      { Product: 'Papas', ProductID: 11, Quantity: 1, TotalSales: 50, Tender: 'Card', TransactionID: 2, DateTime: '2026-08-21T21:00:00-06:00' },
    ]);
    expect(bookkeeping.ventas).toBe(200);
    expect(bookkeeping.unidades).toBe(3);
    expect(bookkeeping.transacciones).toBe(2);
    expect(bookkeeping.metodos_pago).toEqual([{ metodo: 'Cash', total: 150 }, { metodo: 'Card', total: 50 }]);
    expect(bookkeeping.productos).toHaveLength(2);
  });

  it('conserva null cuando DailySales no entrega unidades o transacciones', () => {
    const daily = summarizeDailySales([{ ValueIncVAT: 200, Discount: 5 }]);
    expect(daily.ventas).toBe(200);
    expect(daily.descuentos).toBe(5);
    expect(daily.unidades).toBeNull();
    expect(daily.transacciones).toBeNull();
  });

  it('calcula diferencias sólo en los campos comparables', () => {
    const daily = summarizeDailySales([{ ValueIncVAT: 200 }]);
    const bookkeeping = summarizeBookkeeping([{ Product: 'Mojito', Quantity: 1, TotalSales: 200, Tender: 'Cash' }]);
    const result = buildReconcilePreview('2026-08-21T00:00:00-06:00', '2026-08-22T00:00:00-06:00', daily, bookkeeping);
    expect(result.diferencias).toEqual({ ventas: 0, unidades: null, transacciones: null });
  });
});
