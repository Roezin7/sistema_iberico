/** SKU administrativo verificado en Epos. No confundir artículos gratuitos,
 * cortesías o un nombre parecido con comentarios sin consumo. */
export function esNotaAdministrativaEpos(v: {
  epos_product_id:number|null; producto_nombre:string; cantidad:unknown;
  venta_bruta?:unknown; venta_neta?:unknown; raw_json?:string|null;
}) {
  if(v.epos_product_id!==4098286||v.producto_nombre.trim()!=='Nota'||Number(v.cantidad)!==1||Number(v.venta_bruta)!==0||(v.venta_neta!=null&&Number(v.venta_neta)!==0))return false;
  try{
    const raw=JSON.parse(v.raw_json??'null');
    return !!raw&&Number(raw.ProductId??raw.ProductID)===4098286&&raw.Product==='Nota'&&Number(raw.TotalSales)===0&&Number(raw.NetSales)===0&&Number(raw.CostPrice)===0&&Number(raw.DiscountValue??0)===0&&!(raw.Category??'').trim()&&!(raw.Barcode??'').trim()&&typeof raw.Notes==='string'&&raw.Notes.trim().length>0;
  }catch{return false}
}
