/** Simula la entrega sobre una restauración de producción, nunca en producción. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma as db } from '../src/db.js';
import { inventarioActual } from '../src/inventario/service.js';
import { completarCierre, confirmarControlCierre, vistaPreviaControl } from '../src/inventario/control-cierre.js';
import { valorFifoAlCorte } from '../src/inventario/consumo-epos.js';
const url=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(url.hostname)&&/entrega_test/.test(url.pathname),'Requiere copia local de entrega');
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)).digest('hex');
const evidencia=async()=>({dinero:hash(await db.movimientos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),arqueos:hash(await db.arqueos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),ventas:hash(await db.epos_ventas.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),original:hash(await db.inventory_lines.findMany({where:{snapshot_id:113n},orderBy:[{product_id:'asc'},{zona_id:'asc'}]})),historico:await valorFifoAlCorte(1n,new Date('2026-10-26T05:59:59Z'))});
try{
  const antes=await evidencia(),fisicoAntes=await inventarioActual(1n);
  const u=await db.usuarios.findFirstOrThrow({where:{negocio_id:1n,rol:'admin'}});
  const incompleto=await vistaPreviaControl(1n,74n) as {faltantes:{product_id:number;zona_id:number;producto:string}[]};
  assert.equal(incompleto.faltantes.length,6);assert.deepEqual(incompleto.faltantes.map(f=>f.producto).sort(),['Manzana','Naranja','Pepino','Stella','Ultra','Volt'].sort());
  const nuevo=await completarCierre(1n,u.id,74n,113n,incompleto.faltantes.map(f=>({...f,cantidad_base:0})));
  const p=await vistaPreviaControl(1n,74n) as {revision:string;corte_at:string;filas:{product_id:number;contado:number;diferencia:number;arrastre_previo:number}[]};
  assert.equal(p.filas.length,105);
  const r=await confirmarControlCierre(1n,u.id,74n,BigInt(nuevo.snapshot_id),crypto.randomUUID(),{hash:p.revision,corte_at:p.corte_at});
  const despues=await evidencia(),actual=await inventarioActual(1n);
  assert.deepEqual(despues,antes,'No cambia dinero, arqueos, ventas, conteo original ni valoración histórica');
  for(const f of p.filas){const a=actual.productos.find(p=>p.product_id===f.product_id)!;const previo=fisicoAntes.productos.find(p=>p.product_id===f.product_id)!;assert(Math.abs(a.existencia_actual_base-previo.existencia_actual_base)<.00011,`No cambiar físico ${a.nombre}`);assert(Math.abs((a.cantidad_fifo_base??0)-a.existencia_actual_base)<.00011,`Físico/FIFO alineados ${a.nombre}`);}
  const capas=await db.inventory_lots.count({where:{negocio_id:1n}});const reiterado=await confirmarControlCierre(1n,u.id,74n,BigInt(nuevo.snapshot_id),crypto.randomUUID());assert(reiterado.repetida);assert.equal(await db.inventory_lots.count({where:{negocio_id:1n}}),capas);
  assert.equal((await db.semanas.findUniqueOrThrow({where:{id:74n}})).estado,'abierta');
  console.log(JSON.stringify({ok:true,produccion:false,productos_verificados:actual.productos.length,physical_unchanged:true,fifo_alineado:true,dinero_arqueos_ventas_original_historico_intactos:true,nueva_semana:r.siguiente_semana_id,apertura:r.apertura_snapshot_id,incidencias:r.incidencias,corte:p.corte_at,finanzas_pendientes:true}));
}finally{await db.$disconnect();}
