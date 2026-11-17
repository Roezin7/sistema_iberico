import assert from 'node:assert/strict';
import {prisma as db} from '../src/db.js';
import {consumirVentasEpos} from '../src/inventario/consumo-epos.js';
import {cargarLibroFisico} from '../src/inventario/libro-fisico.js';
const url=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(url.hostname)&&/test|audit/.test(url.pathname));
try {
 const n=await db.negocios.create({data:{nombre:'QA sustituciones '+Date.now()}});
 const s=await db.stores.create({data:{negocio_id:n.id,name:'QA'}});
 const beer=await db.products.create({data:{negocio_id:n.id,store_id:s.id,name:'Corona',unidad_base:'pieza'}});
 const mineral=await db.products.create({data:{negocio_id:n.id,store_id:s.id,name:'Mineral',unidad_base:'ml'}});
 for(const [p,qty,cost]of [[beer,10,20],[mineral,1000,.03]]as const)await db.inventory_lots.create({data:{negocio_id:n.id,product_id:p.id,recibido_at:new Date('2026-11-12'),cantidad_inicial:qty,cantidad_restante:qty,costo_unitario:cost}});
 await db.productos_menu.create({data:{negocio_id:n.id,nombre:'Michelada QA',epos_product_id:123,recetas:{create:{estado:'validada',lineas:{create:{product_id:beer.id,cantidad:1,unidad:'pieza'}}}}}});
 const imp=await db.epos_importaciones.create({data:{negocio_id:n.id,clave:'QA',periodo_desde:new Date('2026-11-12'),periodo_hasta:new Date('2026-11-13')}});
 const sale=await db.epos_ventas.create({data:{negocio_id:n.id,importacion_id:imp.id,clave:'mineral',fecha:new Date('2026-11-12T20:00:00-06:00'),producto_nombre:'Michelada QA',epos_product_id:123,cantidad:2,venta_bruta:114,metodo_pago:'Cash',raw_json:'{"Notes":"Agua M"}',sustituciones_json:JSON.stringify({version:1,confirmado_por:1,confirmado_at:new Date().toISOString(),motivo:'Confirmado300ml por michelada',cambios:[{sustituye_product_id:String(beer.id),product_id:String(mineral.id),nombre:mineral.name,cantidad_base_por_venta:300,unidad_base:'ml'}]})}});
 await db.epos_ventas.create({data:{negocio_id:n.id,importacion_id:imp.id,clave:'normal',fecha:new Date('2026-11-12T21:00:00-06:00'),producto_nombre:'Michelada QA',epos_product_id:123,cantidad:1,venta_bruta:95,metodo_pago:'Cash'}});
 const run=()=>consumirVentasEpos({negocioId:n.id,from:'2026-11-12T06:00:00Z',to:'2026-11-13T06:00:00Z',confirmar:true});
 assert.equal((await run()).costeadas,2);assert.equal((await run()).ya_costeadas,2);
 const c=await db.inventory_consumptions.findMany({where:{epos_venta_id:sale.id}});assert.equal(c.length,1);assert.equal(c[0]!.product_id,mineral.id);assert.equal(Number(c[0]!.cantidad),600);assert.equal(Number(c[0]!.costo_total),18);
 const book=await cargarLibroFisico(db,n.id,new Date('2026-11-13T06:00:00Z'));
 assert.equal(book.errores.length,0);assert.equal(book.eventos.filter(e=>e.tipo==='venta'&&e.product_id===beer.id).reduce((s,e)=>s+e.cantidad,0),1);assert.equal(book.eventos.filter(e=>e.tipo==='venta'&&e.product_id===mineral.id).reduce((s,e)=>s+e.cantidad,0),600);
 console.log(JSON.stringify({ok:true,costo_y_fisico_consistentes:true,no_cerveza_en_variante:true,receta_normal_intacta:true,reintento_sin_duplicar:true}));
}finally{await db.$disconnect()}
