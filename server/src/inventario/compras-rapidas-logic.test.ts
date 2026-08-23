import { describe, expect, it } from 'vitest';
import { cantidadBaseDesdePresentacion, resumirCompra, validarDiscrepanciasCompra } from './compras-rapidas-logic.js';

describe('conversiones de presentación FIFO', () => {
  it('convierte 5 kg de limón en 70 piezas usando el rendimiento configurado', () => {
    expect(cantidadBaseDesdePresentacion({
      cantidadCompra: 5, unidadCompra: 'kg', contenidoPorPresentacion: 14, unidadBase: 'pieza', rendimientoUtil: 1,
    })).toBe(70);
  });

  it('aplica el rendimiento útil cuando la presentación tiene merma', () => {
    expect(cantidadBaseDesdePresentacion({
      cantidadCompra: 2, unidadCompra: 'kg', contenidoPorPresentacion: 1000, unidadBase: 'g', rendimientoUtil: 0.8,
    })).toBe(1600);
  });
});

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

describe('reglas de discrepancias en tickets', () => {
  const productos = [
    { id: 27, name: 'Agua Mineral', unidad_base: 'ml', contenido_compra: 1000, unidad_compra: 'botella', aliases: [] },
    { id: 33, name: 'Tonica', unidad_base: 'ml', contenido_compra: 296, unidad_compra: 'botella', aliases: ['agua tonica'] },
    { id: 47, name: 'Pan', unidad_base: 'g', contenido_compra: 600, unidad_compra: 'paquete', aliases: ['pan de cebolla'] },
  ];

  it('reconoce Schweppes como Tónica y no genera falso positivo', () => {
    const resultado = validarDiscrepanciasCompra(112, [{
      tipo_linea: 'inventario', importe: 112, product_id: 33, descripcion_fuente: 'AGUA SCHWEPPES 296 ML',
      cantidad_base: 1776, unidad_compra: 'botella', contenido_compra: 296, costo_unitario: 112 / 1776,
    }], productos);
    expect(resultado.valida).toBe(true);
    expect(resultado.advertencias.some((d) => d.codigo === 'DESCRIPCION_PRODUCTO_NO_COINCIDE')).toBe(false);
  });

  it('detecta un paquete mal convertido, como pan de cebolla', () => {
    const resultado = validarDiscrepanciasCompra(82.5, [{
      tipo_linea: 'inventario', importe: 82.5, product_id: 47, descripcion_fuente: 'PAN DE CEBOLLA',
      cantidad_base: 200, unidad_compra: 'paquete', contenido_compra: 600,
    }], productos);
    expect(resultado.advertencias.map((d) => d.codigo)).toContain('PRESENTACION_NO_MULTIPLO');
  });

  it('bloquea tickets cuyo desglose no coincide con el total', () => {
    const resultado = validarDiscrepanciasCompra(100, [{
      tipo_linea: 'gasto', importe: 99, descripcion_fuente: 'Diferencia de ticket',
    }]);
    expect(resultado.valida).toBe(false);
    expect(resultado.errores.map((d) => d.codigo)).toContain('TOTAL_NO_CUADRA');
  });
});
