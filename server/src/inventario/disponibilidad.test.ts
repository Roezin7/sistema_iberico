import{describe,it,expect}from'vitest';import{disponibilidadIngrediente}from'./disponibilidad.js';
describe('disponibilidad por envase real',()=>{
 const mineral={cantidad:3000,unidad:'ml',contenido_requerido:600,unidad_requerida:'ml',envases_completos:true};
 it('12L en botellas2L no acreditan5botellas600ml',()=>expect(disponibilidadIngrediente(mineral,'ml',[{cantidad_restante:12000,contenido_presentacion:2000,unidad_presentacion:'ml'}])).toMatchObject({disponible:false,disponible_base:0,envases_faltantes:5}));
 it('cinco botellas600ml cubren un servicio',()=>expect(disponibilidadIngrediente(mineral,'ml',[{cantidad_restante:3000,contenido_presentacion:600,unidad_presentacion:'ml'}]).disponible).toBe(true));
 it('no une medias Coca para afirmar dos envases completos',()=>expect(disponibilidadIngrediente({cantidad:2,unidad:'pieza',contenido_requerido:450,unidad_requerida:'ml',envases_completos:true},'pieza',[{cantidad_restante:1.5,contenido_presentacion:450,unidad_presentacion:'ml'},{cantidad_restante:2,contenido_presentacion:2000,unidad_presentacion:'ml'}])).toMatchObject({disponible:false,disponible_base:1,envases_faltantes:1}));
});
