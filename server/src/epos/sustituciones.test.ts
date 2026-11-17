import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { aplicarSustituciones } from './sustituciones.js';
const lines=[{product_id:35n,cantidad:new Prisma.Decimal(1),unidad:'pieza',products:{name:'Corona',unidad_base:'pieza'}},{product_id:97n,cantidad:new Prisma.Decimal(60),unidad:'ml',products:{name:'Michemix',unidad_base:'ml'}}];
const data={version:1,confirmado_por:1,confirmado_at:'2026-11-17T18:00:00Z',motivo:'Propietario confirma Agua M',cambios:[{sustituye_product_id:'35',product_id:'27',nombre:'Agua Mineral',cantidad_base_por_venta:300,unidad_base:'ml'}]};
describe('variantes confirmadas de una venta',()=>{
 it('conserva la receta normal sin confirmación',()=>expect(aplicarSustituciones(lines)).toBe(lines));
 it('reemplaza sólo Corona por300ml sin mutar la receta',()=>{const out=aplicarSustituciones(lines,JSON.stringify(data));expect(out.map(l=>l.product_id)).toEqual([97n,27n]);expect(Number(out[1]!.cantidad)).toBe(300);expect(lines[0]!.product_id).toBe(35n);});
 it.each([0,-300,Infinity])('rechaza cantidad inválida %s',q=>expect(()=>aplicarSustituciones(lines,JSON.stringify({...data,cambios:[{...data.cambios[0],cantidad_base_por_venta:q}]}))).toThrow());
 it('rechaza evidencia sin confirmar',()=>expect(()=>aplicarSustituciones(lines,JSON.stringify({cambios:data.cambios}))).toThrow());
 it('no duplica ingredientes existentes',()=>expect(()=>aplicarSustituciones(lines,JSON.stringify({...data,cambios:[{...data.cambios[0],product_id:'97'}]}))).toThrow());
 it('no aplica a receta diferente',()=>expect(()=>aplicarSustituciones(lines.slice(1),JSON.stringify(data))).toThrow());
 it('rechaza instrucciones de texto libre',()=>expect(()=>aplicarSustituciones(lines,'Agua M')).toThrow());
});
