import assert from 'node:assert/strict';import{prisma as db}from'../src/db.js';
import{consumirVentasEpos}from'../src/inventario/consumo-epos.js';import{cargarLibroFisico}from'../src/inventario/libro-fisico.js';
import{auditarMapeoEpos}from'../src/epos/mapeo-menu.js';
const u=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(u.hostname)&&/test|audit/.test(u.pathname),'Sólo DB local de pruebas');
try{
 const n=await db.negocios.create({data:{nombre:'QA nota '+Date.now()}});
 const imp=await db.epos_importaciones.create({data:{negocio_id:n.id,clave:'nota',periodo_desde:new Date('2026-11-12'),periodo_hasta:new Date('2026-11-13')}});
 const note=await db.epos_ventas.create({data:{negocio_id:n.id,importacion_id:imp.id,clave:'nota',epos_product_id:4098286,producto_nombre:'Nota',cantidad:1,fecha:new Date('2026-11-12T20:00:00-06:00'),venta_bruta:0,venta_neta:0,metodo_pago:'Cash',raw_json:JSON.stringify({ProductId:4098286,Product:'Nota',Notes:'Jerry',TotalSales:0,NetSales:0,CostPrice:0,Category:'',Barcode:''})}});
 const run=()=>consumirVentasEpos({negocioId:n.id,from:'2026-11-12T00:00:00-06:00',to:'2026-11-13T00:00:00-06:00',confirmar:true});
 assert.equal((await run()).costeadas,1);const saved=await db.epos_ventas.findUniqueOrThrow({where:{id:note.id}});assert.equal(saved.costeo_estado,'costeada');assert.equal(Number(saved.costo_fifo),0);assert.equal(await db.inventory_consumptions.count({where:{negocio_id:n.id}}),0);
 const second=await run();assert.equal(second.ya_costeadas,1);assert.deepEqual(await db.epos_ventas.findUniqueOrThrow({where:{id:note.id}}),saved);
 const book=await cargarLibroFisico(db,n.id,new Date('2026-11-13T06:00:00Z'));assert.equal(book.eventos.length,0);assert.equal(book.errores.length,0);
 assert.equal((await auditarMapeoEpos({negocioId:n.id})).length,0);
 console.log(JSON.stringify({ok:true,nota_sin_receta_ni_consumo:true,no_borra_venta:true,reintento_sin_cambio:true,libro_sin_advertencia_falsa:true,production_writes:0}));
}finally{await db.$disconnect()}
