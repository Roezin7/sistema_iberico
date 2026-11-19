import{describe,it,expect}from'vitest';
import{pendientesSemana}from'./seguimiento';
const resumen=[{semana_id:76,estado:'abierta',origen:'semanal',total:90},{semana_id:76,estado:'documentada',origen:'semanal',total:2},{semana_id:74,estado:'abierta',origen:'arrastre_previo',total:99}];
describe('seguimiento por semana independiente del límite del historial',()=>{
 it('no arrastra diferencias antiguas a la semana abierta',()=>expect(pendientesSemana(resumen,77)).toBe(0));
 it('no incluye como pendientes las explicadas',()=>expect(pendientesSemana(resumen,76)).toBe(90));
 it('separa brecha anterior de diferencia nueva',()=>{expect(pendientesSemana(resumen,74)).toBe(99);expect(pendientesSemana(resumen,74,true)).toBe(0);});
});
