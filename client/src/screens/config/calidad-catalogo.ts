interface ProductoCalidad {active:boolean;unidad_base?:string|null;contenido_compra?:number|null;medidas_errores?:string[]}
export function metricasCatalogo(productos:ProductoCalidad[]) {
 const activos=productos.filter(p=>p.active);
 const conConversion=activos.filter(p=>['g','ml','pieza'].includes(p.unidad_base??'')&&Number(p.contenido_compra)>0&&!p.medidas_errores?.length).length;
 return {activos:activos.length,inactivos:productos.length-activos.length,conConversion,porConfigurar:activos.length-conConversion};
}
