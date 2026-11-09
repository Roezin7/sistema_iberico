import { describe, expect, it } from 'vitest';
import { cantidadBaseConteo, cantidadDesdeSaldo, cantidadEnConteo, medidaConteo, formatosConteo } from './conteo-unidades';

describe('unidades de apertura y cierre', () => {
  const pepino = { unidad_base: 'g', unidad_compra: 'kg', contenido_compra: 1000, presentacion_modo: 'por_lote' };
  it('440 g guardados con factor 1 son 0.44 kg, no 440 kg', () => {
    expect(cantidadDesdeSaldo({ qty_captura: 440, factor: 1 }, pepino, {factor:1000})).toBe(.44);
  });
  it('un snapshot antiguo de 0.44 × 1000 da la misma cantidad', () => {
    expect(cantidadDesdeSaldo({qty_captura:.44,factor:1000}, pepino)).toBe(.44);
  });
  it('el saldo normalizado de la API no vuelve a multiplicarse por catálogo', () => {
    expect(cantidadDesdeSaldo({qty_captura:.44,factor:1000,cantidad_base:440}, pepino)).toBe(.44);
  });
  const casos = [
    {nombre:'Pepino',p:pepino,base:440,visible:.44,unidad:'unidad'},
    {nombre:'Naranja',p:pepino,base:300,visible:.3,unidad:'unidad'},
    {nombre:'Manzana',p:{...pepino,unidad_compra:'pieza',contenido_compra:150},base:600,visible:4,unidad:'pieza'},
    {nombre:'Fresas',p:{...pepino,unidad_compra:'bolsa congelada',contenido_compra:1810},base:1000,visible:1000/1810,unidad:'bolsa'},
    {nombre:'Piña',p:pepino,base:1950,visible:1.95,unidad:'unidad'},
    {nombre:'Agua',p:{unidad_base:'ml',contenido_compra:5000,presentacion_modo:'por_lote'},base:5000,visible:1,unidad:'unidad'},
    {nombre:'Tónica',p:{unidad_base:'ml',contenido_compra:296,presentacion_modo:'por_lote'},base:1776,visible:6,unidad:'unidad'},
    {nombre:'Tequila',p:{unidad_base:'ml',unidad_compra:'botella',contenido_compra:700,presentacion_modo:'exacta'},base:350,visible:.5,unidad:'botella'},
    {nombre:'Limón',p:{unidad_base:'pieza',unidad_compra:'kg',contenido_compra:14,presentacion_modo:'por_lote'},base:98,visible:98,unidad:'pieza'},
    {nombre:'Hierbas',p:{unidad_base:'pieza',unidad_compra:'ramas',contenido_compra:20,presentacion_modo:'por_lote'},base:20,visible:20,unidad:'pieza'},
    {nombre:'Chicharrón',p:{unidad_base:'g',unidad_compra:'porción',contenido_compra:20,presentacion_modo:'variable'},base:20,visible:1,unidad:'porción'},
    {nombre:'Mermelada',p:{unidad_base:'g',unidad_compra:'lote',contenido_compra:400,presentacion_modo:'exacta'},base:1200,visible:3,unidad:'lote'},
    {nombre:'Papel',p:{unidad_base:'pieza',unidad_compra:'caja',contenido_compra:8},base:10,visible:10,unidad:'pieza'},
    {nombre:'Cebolla con descripción ambigua',p:{unidad_base:'g',unidad_compra:'2 piezas',contenido_compra:400,presentacion_modo:'exacta'},base:200,visible:.5,unidad:'unidad'},
  ];
  for (const c of casos) it(`${c.nombre}: etiqueta y cantidad conservan la unidad base al guardar`, () => {
    expect(medidaConteo(c.p).unidad).toBe(c.unidad);
    expect(cantidadEnConteo(c.base,c.p)).toBeCloseTo(c.visible,12);
    expect(cantidadDesdeSaldo({qty_captura:c.base,factor:1},c.p)).toBeCloseTo(c.visible,12);
    expect(cantidadBaseConteo(c.visible,c.p)).toBeCloseTo(c.base,8);
  });
  it('no pierde un peso pequeño por redondear a fracciones de envase', () => {
    expect(cantidadBaseConteo(cantidadEnConteo(.0001,pepino),pepino)).toBeCloseTo(.0001,12);
  });
  it('Prego usa envase documentado de 680 g, no el kg de referencia del catálogo', () => {
    const p={unidad_base:'g',contenido_compra:1000,unidad_compra:'envase',presentacion_modo:'por_lote',formatos_envase:[{contenido:680,unidad:'g',fecha:'2026-11-04'}]};
    expect(medidaConteo(p).factor).toBe(680);
    expect(cantidadEnConteo(1360,p)).toBe(2);
  });
  it('minerales conserva tamaños separados de 600 ml, 1 L y 2 L', () => {
    const p={unidad_base:'ml',unidad_compra:'botella',contenido_compra:2000,presentacion_modo:'por_lote',formatos_envase:[{contenido:600,unidad:'ml',fecha:'2026-11-06'},{contenido:1000,unidad:'ml',fecha:'2026-10-27'}]};
    expect(formatosConteo(p).map(f=>f.factor)).toEqual([600,1000,2000]);
  });
  it('un refresco contado por pieza muestra 450 ml sin multiplicar el número de piezas', () => {
    const p={unidad_base:'pieza',contenido_compra:1,unidad_compra:'pieza',formatos_envase:[{contenido:450,unidad:'ml',fecha:'2026-11-01'}]};
    expect(medidaConteo(p)).toMatchObject({factor:1,etiqueta:'pieza · 450 ml'});
  });
  it('conserva tamaños distintos aunque ambos cuenten como una pieza', () => {
    const p={unidad_base:'pieza',contenido_compra:1,unidad_compra:'pieza',formatos_envase:[{contenido:450,unidad:'ml',fecha:'2026-11-01'},{contenido:2000,unidad:'ml',fecha:'2026-10-01'}]};
    const formatos=formatosConteo(p);
    expect(formatos.some(f=>f.etiqueta==='pieza · 450 ml'&&f.factor===1)).toBe(true);
    expect(formatos.some(f=>f.etiqueta==='pieza · 2 L'&&f.factor===1)).toBe(true);
  });
  it('alcohol exacto conserva botella de 700 ml aunque haya un formato antiguo de 1 L', () => {
    expect(medidaConteo({unidad_base:'ml',unidad_compra:'botella',contenido_compra:700,presentacion_modo:'exacta',formatos_envase:[{contenido:1000,unidad:'ml',fecha:'2026-08-01'}]}).factor).toBe(700);
  });
});
