import { describe, expect, it } from 'vitest';
import { resumirValoracionFifo } from './valoracion-fifo.js';

describe('valoración FIFO única, sin sustitución por catálogo', () => {
  it('conserva costos almacenados aunque se aproximen al precio del catálogo', () => {
    const r = resumirValoracionFifo([
      { product_id: 1, cantidad_restante: 300, costo_unitario: 0.579994 },
      { product_id: 2, cantidad_restante: 1890, costo_unitario: 0.08964 },
    ]);
    expect(r.valor_monetario).toBe(343.42);
    expect(r.productos[0]!.valor).toBeCloseTo(173.9982, 8);
    expect(r.productos[1]!.valor).toBeCloseTo(169.4196, 8);
  });
  it('suma antes de redondear, no suma importes redondeados por producto', () => {
    const r = resumirValoracionFifo([1, 2, 3].map(product_id => ({ product_id, cantidad_restante: 1, costo_unitario: 0.0049 })));
    expect(r.valor_monetario).toBe(0.01);
  });
  it('marca capas estimadas aunque tengan costo técnico cero', () => {
    const r = resumirValoracionFifo([
      { product_id: 1n, cantidad_restante: 2, costo_unitario: 10, costo_estimado: true },
      { product_id: 1n, cantidad_restante: 1, costo_unitario: 0, costo_estimado: true },
      { product_id: 2n, cantidad_restante: 1, costo_unitario: 15 },
    ]);
    expect(r).toMatchObject({ valor: 35, capas_estimadas: 2, valor_estimado: 20, provisional: true });
    expect(r.productos[0]).toMatchObject({ cantidad: 3, valor: 20, capas_estimadas: 2 });
  });
  it('no confunde costo cero confirmado con costo estimado', () => {
    expect(resumirValoracionFifo([{ product_id: 1, cantidad_restante: 3, costo_unitario: 0 }])).toMatchObject({ valor: 0, provisional: false, capas_estimadas: 0 });
  });
  it('un libro vacío no inventa un costo de catálogo', () => {
    expect(resumirValoracionFifo([])).toMatchObject({ valor: 0, lotes: 0, productos: [] });
  });
  it('no modifica cantidades ni costos de entrada', () => {
    const lotes = [{ product_id: 1, cantidad_restante: 1.2345, costo_unitario: 2.345678 }];
    const antes = structuredClone(lotes); resumirValoracionFifo(lotes); expect(lotes).toEqual(antes);
  });
});
