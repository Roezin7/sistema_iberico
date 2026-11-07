import { describe, expect, it } from 'vitest';
import { convertirCompraABase, unidadesMetricasIncompatibles } from './unidades-compra.js';

describe('unidad métrica frente a tamaño del envase', () => {
  it.each([
    { cantidad: .3, unidad: 'kg', base: 'g', contenido: 150, esperado: 300 },
    { cantidad: 300, unidad: 'g', base: 'g', contenido: 1810, esperado: 300 },
    { cantidad: 1.95, unidad: 'kilogramos', base: 'g', contenido: 550, esperado: 1950 },
    { cantidad: 1.2, unidad: 'l', base: 'ml', contenido: 600, esperado: 1200 },
    { cantidad: 600, unidad: 'ml', base: 'ml', contenido: 2000, esperado: 600 },
    { cantidad: 2, unidad: 'botella', base: 'ml', contenido: 700, esperado: 1400 },
    { cantidad: 7, unidad: 'kg', base: 'pieza', contenido: 14, esperado: 98 },
  ])('$cantidad $unidad a $base sin multiplicación doble', c => {
    expect(convertirCompraABase({ cantidadCompra: c.cantidad, unidadCompra: c.unidad, unidadBase: c.base, contenidoPorPresentacion: c.contenido })).toBe(c.esperado);
  });
  it('no convierte kg de producto en ml aunque haya tamaño de catálogo', () => {
    expect(unidadesMetricasIncompatibles('kg', 'ml')).toBe(true);
    expect(convertirCompraABase({ cantidadCompra: 2, unidadCompra: 'kg', unidadBase: 'ml', contenidoPorPresentacion: 1000 })).toBeNull();
  });
  it('no considera dos unidades desconocidas una conversión confirmada', () => {
    expect(convertirCompraABase({ cantidadCompra: 2 })).toBeNull();
  });
});
