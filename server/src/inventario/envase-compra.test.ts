import {describe,it,expect} from 'vitest';
import {envaseCompra} from './envase-compra.js';
describe('envase comercial sin suponer el tamaño del mezclador',()=>{
  it('Coca base pieza no implica 450 ml',()=>expect(envaseCompra({contenido_compra:1,unidad_compra:'botella'},{unidad_base:'pieza',contenido_compra:1,presentacion_modo:'por_lote'}).contenido_presentacion).toBeNull());
  it('un paquete de 6 x 296 no se etiqueta como botella de 1776 ml',()=>expect(envaseCompra({contenido_compra:1776,unidad_compra:'paquete'},{unidad_base:'ml',contenido_compra:296,presentacion_modo:'por_lote'}).contenido_presentacion).toBeNull());
  it('el ticket explícito por botella sí permite registrar el tamaño real',()=>expect(envaseCompra({contenido_compra:600,unidad_compra:'botella'},{unidad_base:'ml',contenido_compra:1000,presentacion_modo:'por_lote'})).toEqual({contenido_presentacion:600,unidad_presentacion:'ml'}));
  it('acepta formato individual explícito de un paquete',()=>expect(envaseCompra({contenido_compra:1776,unidad_compra:'paquete',contenido_presentacion:296,unidad_presentacion:'ml'}).contenido_presentacion).toBe(296));
});
