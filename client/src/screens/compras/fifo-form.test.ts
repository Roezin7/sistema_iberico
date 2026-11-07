import { describe, expect, it } from 'vitest';
import { cantidadBaseCompra } from './fifo-form';
describe('la vista previa usa el mismo contrato de unidades que el servidor', () => {
  it('300 g de fresas no se multiplican por la bolsa de referencia', () => expect(cantidadBaseCompra({cantidad_fuente:300,unidad_fuente:'g',contenido_compra:1810}, {unidad_base:'g',presentacion_modo:'por_lote',contenido_compra:1810})).toBe(300));
  it('0.3 kg de manzana son 300 g, no 0.3 de una pieza de referencia', () => expect(cantidadBaseCompra({cantidad_fuente:.3,unidad_fuente:'kg',contenido_compra:150}, {unidad_base:'g',presentacion_modo:'por_lote',contenido_compra:150})).toBe(300));
  it('las botellas siguen convirtiéndose por su contenido real', () => expect(cantidadBaseCompra({cantidad_fuente:5,unidad_fuente:'botella',contenido_compra:600}, {unidad_base:'ml',presentacion_modo:'por_lote',contenido_compra:2000})).toBe(3000));
  it('el peso variable no se infiere', () => expect(cantidadBaseCompra({cantidad_fuente:1,unidad_fuente:'porción',contenido_compra:20}, {unidad_base:'g',presentacion_modo:'variable'})).toBeNull());
});
