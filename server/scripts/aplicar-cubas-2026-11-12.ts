/** Aplicación acotada e idempotente. Sin APLICAR_CUBAS_20261112=SI sólo consulta. */
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {prisma as db} from '../src/db.js';
import {bloquearLibro} from '../src/inventario/control-cierre.js';
const source='CONFIRMADO-PROPIETARIO-CUBAS-2026-11-12';
const plans=[
 {nombre:'Cuba Jim Beam',epos:4040680,precio:85,lineas:[{product_id:20,cantidad:60,unidad:'ml'},{product_id:26,cantidad:200,unidad:'ml',contenido_requerido:450,unidad_requerida:'ml'}]},
 {nombre:'Cuba de San Matias',epos:4076091,precio:90,lineas:[{product_id:21,cantidad:60,unidad:'ml',contenido_requerido:700,unidad_requerida:'ml'},{product_id:26,cantidad:200,unidad:'ml',contenido_requerido:450,unidad_requerida:'ml'}]},
 {nombre:'Shot Bacardi',epos:4055854,precio:85,lineas:[{product_id:7,cantidad:60,unidad:'ml'}]},
];
async function fingerprints(tx:Prisma.TransactionClient){
 const output:Record<string,string|null>={};
 for(const table of ['semanas','inventory_snapshot','inventario_semanal','inventory_control_closures','inventory_consumptions','epos_ventas','movimientos','arqueos','cierres_semana','purchases','inventory_fifo_reconciliations']){
  const filter=table==='cierres_semana'?'semana_id IN (SELECT id FROM semanas WHERE negocio_id=1)':'negocio_id=1';
  const rows=await tx.$queryRawUnsafe<{hash:string|null}[]>(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) hash FROM ${table} t WHERE ${filter}`);output[table]=rows[0]!.hash;
 }
 output.lines=(await tx.$queryRaw<{hash:string}[]>`SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY l.snapshot_id,l.product_id,l.zona_id),'')) hash FROM inventory_lines l JOIN inventory_snapshot s ON s.id=l.snapshot_id WHERE s.negocio_id=1`)[0]!.hash;
 output.lots=(await tx.$queryRaw<{hash:string}[]>`SELECT md5(coalesce(string_agg(json_build_array(id,product_id,purchase_id,zona_id,recibido_at,cantidad_inicial,cantidad_restante,costo_unitario,estado,fuente,disponible_desde,orden_fifo_at,cierre_control_id,lote_origen_id)::text,',' ORDER BY id),'')) hash FROM inventory_lots WHERE negocio_id=1`)[0]!.hash;
 return output;
}
try{
 const active=await db.productos_menu.findMany({where:{negocio_id:1n,epos_product_id:{in:plans.map(p=>p.epos)}},include:{recetas:{orderBy:{version:'desc'},include:{lineas:true}}}});
 if(process.env.APLICAR_CUBAS_20261112!=='SI'){console.log(JSON.stringify({modo:'preview',planes:plans,existentes:active.map(m=>({id:Number(m.id),nombre:m.nombre,epos:m.epos_product_id,recetas:m.recetas.length}))}));}
 else{
  const result=await db.$transaction(async tx=>{
   await bloquearLibro(tx,1n);
   const user=await tx.usuarios.findUniqueOrThrow({where:{id:1n}});assert.equal(user.negocio_id,1n);assert.equal(user.rol,'admin');
   const before=await fingerprints(tx);
   const products=await tx.products.findMany({where:{negocio_id:1n,id:{in:[7n,20n,21n,26n]}}});assert.equal(products.length,4);
   for(const [id,base]of [[7n,'ml'],[20n,'ml'],[21n,'pieza'],[26n,'pieza']]as const)assert.equal(products.find(p=>p.id===id)!.unidad_base,base);
   const san=products.find(p=>p.id===21n)!;assert.equal(Number(san.contenido_compra),1,'No reinterpretar piezas como ml');
   const notas='Botella de 700 ml confirmada por el propietario 2026-11-12. El inventario conserva piezas/fracciones de botella; una cuba consume 60/700 de pieza. No se modifican cantidades ni costos históricos.';
   const sanActual=await tx.products.update({where:{id:21n},data:{unidad_compra:'botella 700 ml',presentacion_nota:notas}});
   const lotes=await tx.inventory_lots.findMany({where:{negocio_id:1n,product_id:21n,estado:'abierto',cantidad_restante:{gt:0}}});
   for(const l of lotes){
    assert(l.cierre_control_id!=null,'La anotación debe limitarse a capas actuales conciliadas');
    assert((l.unidad_presentacion==='pieza'&&Number(l.contenido_presentacion)===1)||(l.unidad_presentacion==='ml'&&Number(l.contenido_presentacion)===700),'Hay otra presentación: revisar antes de aplicar');
    if(l.unidad_presentacion!=='ml')await tx.inventory_lots.update({where:{id:l.id},data:{contenido_presentacion:700,unidad_presentacion:'ml',notas:(l.notas??'')+' | '+source+': capacidad 700 ml confirmada; cantidad base sigue en piezas.'}});
   }
   const created=[];
   for(const p of plans){
    const existing=await tx.productos_menu.findMany({where:{negocio_id:1n,OR:[{nombre:p.nombre},{epos_product_id:p.epos}]},include:{recetas:{orderBy:{version:'desc'},include:{lineas:true}}}});assert(existing.length<=1,'No unificar duplicados sin revisión');
    let menu=existing[0];
    if(menu){assert.equal(menu.nombre,p.nombre);assert.equal(menu.epos_product_id,p.epos);assert(menu.activo);}
    const same=menu?.recetas.find(r=>r.fuente===source);
    if(same){assert.equal(same.estado,'validada');assert.equal(same.vigente_desde?.toISOString().slice(0,10),'2026-11-12');assert.equal(same.lineas.length,p.lineas.length);for(const line of p.lineas){const saved=same.lineas.find(l=>l.product_id===BigInt(line.product_id));assert(saved);assert.equal(Number(saved.cantidad),line.cantidad);assert.equal(saved.unidad,line.unidad);assert.equal(saved.contenido_requerido==null?null:Number(saved.contenido_requerido),'contenido_requerido'in line?line.contenido_requerido:null);}created.push({menu_id:Number(menu!.id),receta_id:Number(same.id),repetida:true});continue;}
    const m=menu??await tx.productos_menu.create({data:{negocio_id:1n,nombre:p.nombre,epos_product_id:p.epos,precio_venta:p.precio}});
    const recipe=await tx.recetas.create({data:{producto_menu_id:m.id,version:(menu?.recetas[0]?.version??0)+1,estado:'validada',fuente:source,vigente_desde:new Date('2026-11-12'),notas:'Medidas confirmadas por propietario: cubas 60 ml de su alcohol + 200 ml Coca; shot 60 ml Bacardi solo. Precios leídos en Epos, no se suma un costo fijo de $10. Coca usa envase documentado de 450 ml; tamaño distinto/desconocido requiere revisión. Sin reproceso de semanas cerradas.',lineas:{create:p.lineas.map(l=>({...l,product_id:BigInt(l.product_id),envases_completos:false,nota:'contenido_requerido'in l?`Porción en ml; conversión explícita contra envase de ${l.contenido_requerido} ml.`:'60 ml confirmados por el propietario.'}))}}});
    await tx.auditoria_eventos.create({data:{negocio_id:1n,usuario_id:1n,entidad:'receta',entidad_id:String(recipe.id),accion:'crear_validada',despues:JSON.stringify({menu_id:Number(m.id),epos:p.epos,precio_epos:p.precio,lineas:p.lineas}),metadata:JSON.stringify({fuente:source,vigente_desde:'2026-11-12',cierres_anteriores_intactos:true})}});
    created.push({menu_id:Number(m.id),receta_id:Number(recipe.id),nombre:p.nombre,epos:p.epos});
   }
   if(san.unidad_compra!==sanActual.unidad_compra)await tx.auditoria_eventos.create({data:{negocio_id:1n,usuario_id:1n,entidad:'producto',entidad_id:'21',accion:'documentar_presentacion',antes:JSON.stringify({unidad_compra:san.unidad_compra,unidad_base:san.unidad_base,contenido_compra:Number(san.contenido_compra)}),despues:JSON.stringify({unidad_compra:sanActual.unidad_compra,capacidad_ml:700,unidad_base:'pieza',contenido_compra:1,lotes_actuales:lotes.map(l=>Number(l.id))}),metadata:JSON.stringify({fuente:source,sin_conversion_del_historico:true})}});
   assert.deepEqual(await fingerprints(tx),before,'Se modificó historia, cantidades o dinero');
   return {recetas:created,capacidad_san_matias_ml:700,unidad_inventario_preservada:'pieza',historia_cantidades_y_dinero_intactos:true};
  },{timeout:120000,maxWait:20000});console.log(JSON.stringify({ok:true,...result}));
 }
}finally{await db.$disconnect()}
