import assert from'node:assert/strict';import{prisma as db}from'../src/db.js';import{consumirVentasEpos}from'../src/inventario/consumo-epos.js';import{cargarLibroFisico}from'../src/inventario/libro-fisico.js';import{auditarMapeoEpos}from'../src/epos/mapeo-menu.js';
const u=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(u.hostname)&&/test|audit/.test(u.pathname),'Sólo DB local de pruebas');
try{
 const n=await db.negocios.create({data:{nombre:'QA café '+Date.now()}}),store=await db.stores.create({data:{negocio_id:n.id,name:'QA'+n.id}});
 const coffee=await db.products.create({data:{negocio_id:n.id,store_id:store.id,name:'Café espresso',unidad_base:'g',contenido_compra:100,unit_cost:50}}),water=await db.products.create({data:{negocio_id:n.id,store_id:store.id,name:'Agua natural',unidad_base:'ml',contenido_compra:1000,unit_cost:10}});
 for(const [product,qty,cost]of [[coffee,100,.5],[water,1000,.01]]as const)await db.inventory_lots.create({data:{negocio_id:n.id,product_id:product.id,recibido_at:new Date('2026-11-14'),cantidad_inicial:qty,cantidad_restante:qty,costo_unitario:cost}});
 const menu=await db.productos_menu.create({data:{negocio_id:n.id,nombre:'Café americano',epos_product_id:3978590,precio_venta:45,recetas:{create:{estado:'validada',lineas:{create:[{product_id:coffee.id,cantidad:5,unidad:'g'},{product_id:water.id,cantidad:300,unidad:'ml'}]}}}}});
 const imp=await db.epos_importaciones.create({data:{negocio_id:n.id,clave:'QA',periodo_desde:new Date('2026-11-15'),periodo_hasta:new Date('2026-11-16')}});
 const sale=await db.epos_ventas.create({data:{negocio_id:n.id,importacion_id:imp.id,clave:'cafe',fecha:new Date('2026-11-15T21:31:00-06:00'),producto_nombre:'Café',epos_product_id:3978588,cantidad:1,venta_bruta:45,metodo_pago:'Cash'}});
 const run=()=>consumirVentasEpos({negocioId:n.id,from:'2026-11-15T00:00:00-06:00',to:'2026-11-16T00:00:00-06:00',confirmar:true});assert.equal((await run()).costeadas,1);
 const saved=await db.epos_ventas.findUniqueOrThrow({where:{id:sale.id}});assert.equal(saved.epos_product_id,3978588);assert.equal(Number(saved.costo_fifo),5.5);assert.equal((await db.productos_menu.findUniqueOrThrow({where:{id:menu.id}})).epos_product_id,3978590);
 assert.equal((await run()).ya_costeadas,1);assert.equal(await db.inventory_consumptions.count({where:{negocio_id:n.id}}),2);
 const book=await cargarLibroFisico(db,n.id,new Date('2026-11-16T06:00:00Z'));assert.equal(book.errores.length,0);assert.equal(book.eventos.length,2);
 const mapping=await auditarMapeoEpos({negocioId:n.id});assert.equal(mapping[0]!.estado,'mapeado');assert.equal(mapping[0]!.menu_id,Number(menu.id));
 console.log(JSON.stringify({ok:true,ids_originales_intactos:true,cafe_5g_agua300ml:true,costo_fifo:5.5,libro_y_mapeo_consistentes:true,reintento_sin_duplicar:true,production_writes:0}));
}finally{await db.$disconnect()}
