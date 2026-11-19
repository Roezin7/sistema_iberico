import{describe,it,expect}from'vitest';
import{metricasCatalogo}from'./calidad-catalogo';
const valid={active:true,unidad_base:'g',contenido_compra:680};
describe('métricas de catálogo con un mismo universo activo',()=>{
 it('no convierte un retirado sin datos en tarea actual',()=>expect(metricasCatalogo([valid,{active:false}])).toEqual({activos:1,inactivos:1,conConversion:1,porConfigurar:0}));
 it('incluye errores de medidas aunque tenga contenido',()=>expect(metricasCatalogo([{...valid,medidas_errores:['Dimensión incorrecta']}]).porConfigurar).toBe(1));
 it('rechaza una etiqueta de base no canónica',()=>expect(metricasCatalogo([{...valid,unidad_base:'botella'}]).conConversion).toBe(0));
 it('no considera válido contenido cero',()=>expect(metricasCatalogo([{...valid,contenido_compra:0}]).porConfigurar).toBe(1));
 it('configurados más pendientes coincide con activos',()=>{const m=metricasCatalogo([valid,{active:true},{active:false}]);expect(m.conConversion+m.porConfigurar).toBe(m.activos);});
});
