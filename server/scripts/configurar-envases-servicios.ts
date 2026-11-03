/** Sólo presentaciones con evidencia; no cambia cantidad, precio, pagos ni
 * consumos históricos. Dry-run por defecto. Ejecutar antes del primer cierre. */
import assert from 'node:assert/strict';
import { prisma as db } from '../src/db.js';
import { bloquearLibro } from '../src/inventario/control-cierre.js';
import { envaseCompra } from '../src/inventario/envase-compra.js';
const aplicar=process.env.APPLY_PRESENTACIONES==='YES';
try {
  const menus=await db.productos_menu.findMany({where:{negocio_id:1n,id:{in:[153n,164n,173n,174n,175n,182n,187n]},activo:true},include:{recetas:{where:{estado:'validada'},orderBy:{version:'desc'},take:1,include:{lineas:true}}}});
  assert.equal(menus.length,7,'El catálogo cambió; revisar el alcance antes de aplicar');
  const compras=await db.purchases.findMany({where:{negocio_id:1n,estado:'confirmada'},include:{inventory_lots:true,purchase_lines:{include:{products:true}}}});
  const cambios:{id:bigint;contenido_presentacion:number;unidad_presentacion:string;fuente:string}[]=[];
  for(const c of compras)for(const l of c.inventory_lots){
    let formato:{contenido_presentacion:number|null;unidad_presentacion:string|null}={contenido_presentacion:null,unidad_presentacion:null};
    if(c.id===104n&&c.ticket_ref==='451498'&&l.product_id===27n&&Number(l.cantidad_inicial)===3600)formato={contenido_presentacion:600,unidad_presentacion:'ml'};
    else if(c.id===105n&&c.ticket_ref==='451502'&&l.product_id===26n&&Number(l.cantidad_inicial)===5)formato={contenido_presentacion:450,unidad_presentacion:'ml'};
    else {const p=c.purchase_lines.find(p=>p.product_id===l.product_id);if(p&&p.unidad_compra!=='mixta')formato=envaseCompra(p,p.products);}
    if(formato.contenido_presentacion&&formato.unidad_presentacion&&l.contenido_presentacion==null)cambios.push({id:l.id,contenido_presentacion:formato.contenido_presentacion,unidad_presentacion:formato.unidad_presentacion,fuente:`Ticket confirmado ${c.ticket_ref??c.id}; unidad individual documentada, no contenido agregado de paquete`});
  }
  const tag='CONTROL-FIFO-ENVASES-2026-11-03';
  const nuevas=menus.filter(m=>!m.recetas[0]?.fuente?.includes(tag));
  for(const m of nuevas){const r=m.recetas[0];assert(r&&(m.id===153n?r.lineas.some(l=>l.product_id===26n&&Number(l.cantidad)===1):r.lineas.some(l=>l.product_id===27n&&Number(l.cantidad)===3000)&&r.lineas.some(l=>l.product_id===26n&&Number(l.cantidad)===2)),'La receta cambió; no modificar por coincidencia parcial');}
  if(aplicar)await db.$transaction(async tx=>{
    await bloquearLibro(tx,1n);
    const usuario=await tx.usuarios.findFirstOrThrow({where:{negocio_id:1n,rol:'admin'}});
    for(const c of cambios){const antes=await tx.inventory_lots.findUniqueOrThrow({where:{id:c.id}});await tx.inventory_lots.update({where:{id:c.id},data:{contenido_presentacion:c.contenido_presentacion,unidad_presentacion:c.unidad_presentacion}});await tx.auditoria_eventos.create({data:{negocio_id:1n,usuario_id:usuario.id,entidad:'lote',entidad_id:String(c.id),accion:'documentar_envase_ticket',antes:JSON.stringify({contenido:antes.contenido_presentacion,unidad:antes.unidad_presentacion}),despues:JSON.stringify(c,(_,v)=>typeof v==='bigint'?String(v):v),metadata:JSON.stringify({sin_recosteo:true,sin_cambio_cantidad:true})}});}
    for(const m of nuevas){const r=m.recetas[0]!;const creada=await tx.recetas.create({data:{producto_menu_id:m.id,version:r.version+1,estado:'validada',vigente_desde:new Date('2026-11-03'),fuente:tag,notas:m.id===153n?'Coca por pieza requiere envase documentado de 450 ml; no se sustituye por una botella de otro tamaño.': 'Servicio completo: botella de su marca + 5 minerales de 600 ml + 2 Coca de 450 ml. Exige presentación documentada por lote; tamaños desconocidos quedan pendientes, no se adivinan.',lineas:{create:r.lineas.map(l=>({product_id:l.product_id,cantidad:l.cantidad,unidad:l.unidad,nota:l.nota,envases_completos:m.id!==153n,contenido_requerido:m.id===153n&&l.product_id!==26n?null:l.product_id===27n?600:l.product_id===26n?450:l.unidad==='pieza'?1:Number(l.cantidad),unidad_requerida:m.id===153n&&l.product_id!==26n?null:l.product_id===27n||l.product_id===26n?'ml':l.unidad}))}}});await tx.auditoria_eventos.create({data:{negocio_id:1n,usuario_id:usuario.id,entidad:'receta',entidad_id:String(creada.id),accion:'version_envases_servicio',antes:JSON.stringify({receta_id:String(r.id)}),despues:JSON.stringify({menu_id:String(m.id),version:creada.version}),metadata:JSON.stringify({sin_cambio_precio:true,sin_recosteo_historico:true})}});}
  },{timeout:90000});
  console.log(JSON.stringify({aplicado:aplicar,lotes_con_evidencia:cambios.length,servicios_versionados:nuevas.map(m=>m.nombre),sin_cambios_de_cantidad_precio_o_dinero:true}));
}finally{await db.$disconnect();}
