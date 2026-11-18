import{describe,it,expect}from'vitest';import{textoMedida}from'./medidas-operativas.js';
describe('cantidad y unidad inseparables',()=>{
 it('350ml no son350botellas',()=>expect(textoMedida({cantidad_base:350,cantidad_operativa:.5,unidad_base:'ml',unidad_operativa:'botella',contenido_compra:700})).toBe('0.5 botellas de 700 ml'));
 it('convierte con factor documentado aunque falte alias operativo',()=>expect(textoMedida({cantidad_base:525,unidad_base:'ml',unidad_operativa:'botella',contenido_compra:700})).toBe('0.75 botellas de 700 ml'));
 it('sin factor conserva ml, no inventa botellas',()=>expect(textoMedida({cantidad_base:350,unidad_base:'ml',unidad_operativa:'botella'})).toBe('350 ml'));
 it('no multiplica piezas por el contenido de una caja',()=>expect(textoMedida({cantidad_base:3,unidad_base:'pieza',unidad_operativa:'pieza',contenido_compra:24})).toBe('3 piezas'));
 it('gramos y bolsas se convierten juntos',()=>expect(textoMedida({cantidad_base:550,unidad_base:'g',unidad_operativa:'bolsa',contenido_compra:1000})).toBe('0.55 bolsas de 1,000 g'));
});
