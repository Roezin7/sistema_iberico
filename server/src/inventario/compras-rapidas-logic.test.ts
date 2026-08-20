import { describe, expect, it } from 'vitest';
import { resumirCompra } from './compras-rapidas-logic.js';

describe('resumen de tickets de compra', () => {
  it('cuadra una compra sólo de inventario', () => {
    expect(resumirCompra(100, [{ tipo_linea: 'inventario', importe: 100 }])).toEqual({
      totalLineas: 100, inventario: 100, gasto: 0, pendiente: 0, cuadra: true,
    });
  });

  it('cuadra una compra sólo de gasto', () => {
    expect(resumirCompra(50, [{ tipo_linea: 'gasto', importe: 50 }])).toEqual({
      totalLineas: 50, inventario: 0, gasto: 50, pendiente: 0, cuadra: true,
    });
  });

  it('separa una compra mixta sin duplicar el total', () => {
    expect(resumirCompra(140, [
      { tipo_linea: 'inventario', importe: 90 },
      { tipo_linea: 'gasto', importe: 50 },
    ])).toEqual({ totalLineas: 140, inventario: 90, gasto: 50, pendiente: 0, cuadra: true });
  });

  it('no permite confirmar una diferencia pendiente como gasto', () => {
    expect(resumirCompra(100, [{ tipo_linea: 'inventario', importe: 90 }])).toMatchObject({
      inventario: 90, gasto: 0, pendiente: 0, cuadra: false,
    });
  });
});
