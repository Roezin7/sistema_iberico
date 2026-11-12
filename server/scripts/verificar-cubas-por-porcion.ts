import assert from 'node:assert/strict';
import {prisma as db} from '../src/db.js';
import {consumirVentasEpos} from '../src/inventario/consumo-epos.js';
import {crearConteo,inventarioActual} from '../src/inventario/service.js';
const url=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(url.hostname)&&/test|audit/.test(url.pathname),'Sólo DB local de pruebas');
try{
 const n=await db.negocios.create({data:{nombre:'QA cubas '+Date.now()}});
 const s=await db.stores.create({data:{negocio_id:n.id,name:'QA '+n.id}});
 const z=await db.zonas_inventario.create({data:{negocio_id:n.id,nombre:'Local'}});
 const w=await db.semanas.create({data:{negocio_id:n.id,etiqueta:'QA46',fecha_inicio:new Date('2026-11-09'),fecha_fin:new Date('2026-11-15')}});
 const p=[];for(const [name,base,contenido]of [['Jim','ml',700],['San Matías','pieza',1],['Bacardi','ml',700],['Coca','pieza',1]]as const)p.push(await db.products.create({data:{negocio_id:n.id,store_id:s.id,name:name+n.id,unidad_base:base,contenido_compra:contenido,unidad_compra:'botella',unit_cost:100}}));
 const saldos=[700,.7,700,8];
 const opening=await crearConteo(n.id,p.map((x,i)=>({product_id:Number(x.id),zona_id:Number(z.id),qty_captura:saldos[i]!,cantidad_base:saldos[i]!})),{tipo:'apertura',semana_id:Number(w.id),contado_at:'2026-11-09T00:00:00-06:00'});
 const snapshot=await db.inventory_lines.findMany({where:{snapshot_id:BigInt(opening.snapshot_id)}});
 const lot=async(i:number,qty:number,cost:number,size:number|null,unit:string|null,day='2026-11-09')=>db.inventory_lots.create({data:{negocio_id:n.id,product_id:p[i]!.id,zona_id:z.id,recibido_at:new Date(day),cantidad_inicial:qty,cantidad_restante:qty,costo_unitario:cost,contenido_presentacion:size,unidad_presentacion:unit}});
 await lot(0,700,.5,700,'ml');const san=await lot(1,.7,250,700,'ml');await lot(2,700,.35,700,'ml');
 const wrong=await lot(3,5,30,2000,'ml','2026-11-08'),unknown=await lot(3,1,20,null,null,'2026-11-08'),coca=await lot(3,2,17.5,450,'ml');
 const imp=await db.epos_importaciones.create({data:{negocio_id:n.id,clave:'QA',periodo_desde:new Date('2026-11-12'),periodo_hasta:new Date('2026-11-13')}});
 const expected=[30+17.5*200/450,250*60/700+17.5*200/450,21];
 for(let i=0;i<3;i++){
  const menu=await db.productos_menu.create({data:{negocio_id:n.id,nombre:'QA'+i+n.id,epos_product_id:900+i,recetas:{create:{estado:'validada',vigente_desde:new Date('2026-11-12'),lineas:{create:[{product_id:p[i]!.id,cantidad:60,unidad:'ml',...(i===1?{contenido_requerido:700,unidad_requerida:'ml'}:{})},...(i<2?[{product_id:p[3]!.id,cantidad:200,unidad:'ml',contenido_requerido:450,unidad_requerida:'ml'}]:[])]}}}}});
  await db.epos_ventas.create({data:{negocio_id:n.id,importacion_id:imp.id,clave:'v'+i,epos_product_id:900+i,producto_nombre:menu.nombre,fecha:new Date('2026-11-12T12:00:00-06:00'),cantidad:1,venta_bruta:85,metodo_pago:'Cash'}});
 }
 const run=()=>consumirVentasEpos({negocioId:n.id,from:'2026-11-12T00:00:00-06:00',to:'2026-11-13T00:00:00-06:00',confirmar:true});
 const first=await run();assert.equal(first.costeadas,3);assert.equal(first.excepciones,0);
 const sales=await db.epos_ventas.findMany({where:{negocio_id:n.id},orderBy:{id:'asc'}});sales.forEach((v,i)=>assert(Math.abs(Number(v.costo_fifo)-expected[i]!)<.02));
 assert.equal(Number((await db.inventory_lots.findUniqueOrThrow({where:{id:coca.id}})).cantidad_restante),1.1112);
 assert.equal(Number((await db.inventory_lots.findUniqueOrThrow({where:{id:san.id}})).cantidad_restante),.6143);
 for(const l of [wrong,unknown])assert.equal(Number((await db.inventory_lots.findUniqueOrThrow({where:{id:l.id}})).cantidad_restante),Number(l.cantidad_restante));
 const count=await db.inventory_consumptions.count({where:{negocio_id:n.id}});await run();assert.equal(await db.inventory_consumptions.count({where:{negocio_id:n.id}}),count);
 assert.deepEqual(await db.inventory_lines.findMany({where:{snapshot_id:BigInt(opening.snapshot_id)}}),snapshot);
 const stock=await inventarioActual(n.id);assert(Math.abs(stock.productos.find(x=>x.product_id===Number(p[1]!.id))!.existencia_actual_base-(.7-60/700))<.0001);
 console.log(JSON.stringify({ok:true,costeadas:3,formatos_desconocidos_y_2L_no_sustituyen_450ml:true,cantidad_y_costo_por_fraccion:true,reintento_sin_duplicados:true,apertura_intacta:true,production_writes:0}));
}finally{await db.$disconnect()}
