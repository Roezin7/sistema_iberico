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
  it('200 ml de Coca equivalen a una fracción de una botella documentada de 450 ml', () => {
    expect(convertirCantidad(200,'ml','pieza',{contenido_requerido:450,unidad_requerida:'ml'})).toBeCloseTo(200/450,12);
    expect(costoLinea(200,'ml',{unitCost:17.5,unidadBase:'pieza',contenidoCompra:1,rendimientoUtil:1},{contenido_requerido:450,unidad_requerida:'ml'}).costoEstimado).toBeCloseTo(17.5*200/450,10);
  });
  it('60 ml de San Matías no consumen una botella completa de 700 ml', () => {
    expect(convertirCantidad(60,'ml','pieza',{contenido_requerido:700,unidad_requerida:'ml'})).toBeCloseTo(60/700,12);
  });
  it.each([undefined,{contenido_requerido:450},{contenido_requerido:0,unidad_requerida:'ml'},{contenido_requerido:450,unidad_requerida:'g'}])('no adivina volumen por pieza con presentación incompatible %j', presentacion => {
    expect(convertirCantidad(200,'ml','pieza',presentacion)).toBeNull();
  });
  it('una receta directa por pieza sigue contando una pieza, no 450', () => {
    expect(convertirCantidad(1,'pieza','pieza',{contenido_requerido:450,unidad_requerida:'ml'})).toBe(1);
  });
});
