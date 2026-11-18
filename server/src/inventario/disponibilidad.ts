import{prisma}from'../db.js';
import{convertirCantidad}from'../recetas/costeo.js';
import{loteElegibleParaReceta,saldoEnvasesCompletos}from'./presentaciones.js';
import{efectivaLote,fechaMexico}from'./libro-fisico.js';

export function disponibilidadIngrediente(l:{cantidad:unknown;unidad:string;contenido_requerido?:unknown;unidad_requerida?:string|null;envases_completos?:boolean},base:string|null,lotes:{cantidad_restante:unknown;contenido_presentacion?:unknown;unidad_presentacion?:string|null}[]) {
 const objetivo=base?convertirCantidad(Number(l.cantidad),l.unidad,base,l):null;
 const elegibles=lotes.filter(t=>loteElegibleParaReceta(t,l,base));
 const disponible=elegibles.reduce((s,t)=>s+(l.envases_completos?saldoEnvasesCompletos(Number(t.cantidad_restante),Number(l.contenido_requerido),base):Number(t.cantidad_restante)),0);
 const faltante=objetivo==null?null:Math.max(0,Math.round((objetivo-disponible)*10000)/10000);
 return {requerido_base:objetivo,disponible_base:disponible,faltante_base:faltante,disponible:objetivo!=null&&faltante===0,contenido_envase:l.contenido_requerido==null?null:Number(l.contenido_requerido),unidad_envase:l.unidad_requerida??null,envases_completos:!!l.envases_completos,envases_faltantes:!l.envases_completos||faltante==null?null:Math.ceil(faltante/(base==='pieza'?1:Number(l.contenido_requerido)))};
}
export async function disponibilidadMenu(negocioId:bigint){
 const ahora=new Date();const [menus,lotes]=await Promise.all([
  prisma.productos_menu.findMany({where:{negocio_id:negocioId,activo:true},select:{id:true,nombre:true,recetas:{where:{estado:'validada',OR:[{vigente_desde:null},{vigente_desde:{lte:new Date(fechaMexico(ahora))}}]},orderBy:{version:'desc'},take:1,include:{lineas:{include:{products:{select:{name:true,unidad_base:true}}}}}}}}),
  prisma.inventory_lots.findMany({where:{negocio_id:negocioId,estado:'abierto',cantidad_restante:{gt:0},fuente:{not:'historico_prueba'}},include:{purchases:{select:{recibida_at:true}}}})
 ]);
 const actuales=lotes.filter(l=>efectivaLote(l)<=ahora);
 return {calculado_at:ahora.toISOString(),criterio:'Disponibilidad para preparar una unidad. No es demanda ni orden automática de compra.',menus:menus.map(m=>{const lineas=m.recetas[0]?.lineas??[];const necesidades=lineas.map(l=>({product_id:Number(l.product_id),producto:l.products.name,unidad_base:l.products.unidad_base,...disponibilidadIngrediente(l,l.products.unidad_base,actuales.filter(t=>t.product_id===l.product_id))}));return {menu_id:Number(m.id),nombre:m.nombre,disponible:lineas.length>0&&necesidades.every(n=>n.disponible),requiere_formatos:lineas.some(l=>l.envases_completos),necesidades}})};
}
