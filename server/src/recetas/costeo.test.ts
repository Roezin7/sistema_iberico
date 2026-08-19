import { describe, expect, it } from 'vitest';
import { convertirCantidad, costoLinea } from './costeo.js';

describe('costeo por presentación', () => {
  it('costea ml contra el contenido de la botella', () => {
    const r = costoLinea(59.15, 'ml', { unitCost: 213, unidadBase: 'ml', contenidoCompra: 700, rendimientoUtil: 1 });
    expect(r.costoUnitarioBase).toBeCloseTo(213 / 700, 8);
    expect(r.costoEstimado).toBeCloseTo(59.15 * 213 / 700, 5);
  });

  it('convierte oz a ml', () => {
    expect(convertirCantidad(2, 'oz', 'ml')).toBeCloseTo(59.147, 3);
  });

  it('costea piezas directas', () => {
    const r = costoLinea(1, 'pieza', { unitCost: 19, unidadBase: 'pieza', contenidoCompra: 1, rendimientoUtil: 1 });
    expect(r.costoEstimado).toBe(19);
  });

  it('no inventa costo cuando falta la presentación', () => {
    const r = costoLinea(150, 'g', { unitCost: 199, unidadBase: null, contenidoCompra: null, rendimientoUtil: 1 });
    expect(r.costoEstimado).toBeNull();
    expect(r.faltaConfiguracion).toEqual(expect.arrayContaining(['unidad_base', 'contenido_compra']));
  });

  it('rechaza unidades incompatibles explícitamente', () => {
    const r = costoLinea(30, 'g', { unitCost: 100, unidadBase: 'ml', contenidoCompra: 1000, rendimientoUtil: 1 });
    expect(r.costoEstimado).toBeNull();
    expect(r.faltaConfiguracion[0]).toContain('unidad_incompatible');
  });
});
