/** Entrega puntual autorizada por el propietario: cierre físico 44, no cierre
 * financiero. Simulación por defecto. No reutilizar para otras semanas. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma as db } from '../src/db.js';
import { inventarioActual } from '../src/inventario/service.js';
import { completarCierre, confirmarControlCierre, vistaPreviaControl } from '../src/inventario/control-cierre.js';
const aplicar=process.env.APPLY_CONTROL_CIERRE==='SEMANA_44_CONFIRMADA';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)).digest('hex');
const evidencia=async()=>({dinero:hash(await db.movimientos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),arqueos:hash(await db.arqueos.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),ventas:hash(await db.epos_ventas.findMany({where:{negocio_id:1n},orderBy:{id:'asc'}})),original:hash(await db.inventory_lines.findMany({where:{snapshot_id:113n},orderBy:[{product_id:'asc'},{zona_id:'asc'}]}))});
try{
  const existente=await db.inventory_control_closures.findFirst({where:{negocio_id:1n,semana_id:74n}});
  if(existente){console.log(JSON.stringify({ya_entregado:true,cierre_id:String(existente.id),apertura_id:String(existente.siguiente_snapshot_id),sin_nuevas_mutaciones:true}));}
  else{
    const w=await db.semanas.findFirstOrThrow({where:{negocio_id:1n,id:74n}});assert.equal(w.estado,'abierta');assert.equal(w.fecha_inicio.toISOString().slice(0,10),'2026-10-26');
    const c=await db.inventario_semanal.findUniqueOrThrow({where:{semana_id:74n}});assert.equal(c.cierre_snapshot_id,113n,'El conteo cambió desde la revisión del propietario');
    const incompleto=await vistaPreviaControl(1n,74n) as {faltantes?:{product_id:number;zona_id:number;producto:string;zona:string}[]};
    assert(incompleto.faltantes);assert.deepEqual(incompleto.faltantes.map(f=>f.producto).sort(),['Manzana','Naranja','Pepino','Stella','Ultra','Volt'].sort());assert(incompleto.faltantes.every(f=>f.zona==='Bodega'));
    if(!aplicar)console.log(JSON.stringify({aplicar:false,semana_calendario:44,conteo:113,ceros_confirmados_por_propietario:incompleto.faltantes,sin_cierre_financiero:true}));
    else{
      const antes=await evidencia(),fisico=await inventarioActual(1n);const usuario=await db.usuarios.findFirstOrThrow({where:{negocio_id:1n,rol:'admin'}});
      const nueva=await completarCierre(1n,usuario.id,74n,113n,incompleto.faltantes.map(f=>({...f,cantidad_base:0})));
      const preview=await vistaPreviaControl(1n,74n) as {revision:string;corte_at:string};
      const r=await confirmarControlCierre(1n,usuario.id,74n,BigInt(nueva.snapshot_id),crypto.randomUUID(),{hash:preview.revision,corte_at:preview.corte_at});
      const despues=await evidencia(),actual=await inventarioActual(1n);assert.deepEqual(despues,antes,'Cambió evidencia ajena al cierre físico');
      for(const p of actual.productos){assert(Math.abs((fisico.productos.find(f=>f.product_id===p.product_id)?.existencia_actual_base??0)-p.existencia_actual_base)<.00011,`Cambió físico ${p.nombre}`);assert(Math.abs((p.cantidad_fifo_base??0)-p.existencia_actual_base)<.00011,`FIFO no alineado ${p.nombre}`);}
      assert.equal((await db.semanas.findUniqueOrThrow({where:{id:74n}})).estado,'abierta');
      console.log(JSON.stringify({aplicado:true,cierre_id:r.cierre_id,conteo_completado:nueva.snapshot_id,apertura:r.apertura_snapshot_id,siguiente_semana_id:r.siguiente_semana_id,productos_verificados:actual.productos.length,fisico_sin_cambio:true,fifo_alineado:true,dinero_arqueos_ventas_original_sin_cambio:true,finanzas_pendientes:true,corte:preview.corte_at,incidencias:r.incidencias,huellas:despues}));
    }
  }
}finally{await db.$disconnect();}
