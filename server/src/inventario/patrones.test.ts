import {describe,it,expect} from 'vitest';
import {patronesInventario} from './patrones.js';
const caso=(semana_id:number,extra={})=>({product_id:1,producto:'Mineral',semana_id,origen:'semanal',diferencia:-100,causa:'sin_explicar',estado:'abierta',valor:10,unidad:'ml',...extra});
describe('patrones históricos sin convertirlos en pendientes nuevos',()=>{
 it('dos registros de un solo cierre no constituyen repetición',()=>expect(patronesInventario([caso(1),caso(1)],[])).toEqual([]));
 it('conserva cantidad, valor y semanas de los casos por explicar',()=>expect(patronesInventario([caso(1),caso(2)],[])[0]).toMatchObject({cantidad:200,valor:20,semanas:[1,2],pendientes:2,documentadas:0,estado:'por_explicar'}));
 it('una tendencia documentada permanece visible sin tarea sin explicar',()=>expect(patronesInventario([caso(1,{causa:'merma',estado:'documentada'}),caso(2,{causa:'merma',estado:'documentada'})],[])[0]).toMatchObject({estado:'documentada',pendientes:0,documentadas:2}));
 it('si falta una explicación no etiqueta todo como documentado',()=>expect(patronesInventario([caso(1,{causa:'merma',estado:'documentada'}),caso(2,{causa:'merma',estado:'investigando'})],[])[0]).toMatchObject({estado:'por_explicar',pendientes:1,documentadas:1}));
 it('no mezcla sobrantes con faltantes',()=>expect(patronesInventario([caso(1),caso(2,{diferencia:100})],[])).toEqual([]));
 it('no convierte arrastre o errores de presentación en merma recurrente',()=>expect(patronesInventario([caso(1,{origen:'arrastre_previo'}),caso(2,{origen:'arrastre_previo'}),caso(1,{causa:'error_presentacion'}),caso(2,{causa:'error_presentacion'})],[])).toEqual([]));
 it('cuenta las salidas registradas como tendencia documentada',()=>{const s=(semana_id:number)=>({product_id:1,producto:'Mineral',semana_id,tipo:'merma',cantidad:-50,valor:5,unidad:'ml'});expect(patronesInventario([],[s(1),s(2)])[0]).toMatchObject({cantidad:100,valor:10,estado:'documentada',pendientes:0});});
 it('no muta los casos ni crea otra salida al resumir',()=>{const cases=[caso(1),caso(2)],before=structuredClone(cases);patronesInventario(cases,[]);expect(cases).toEqual(before);});
});
