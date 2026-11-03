/** Una presentación base no siempre es un envase: 1 Coca (pieza) puede ser
 * de 450 ml o 2 L. Sólo inferir envase de una línea explícita por botella;
 * para catálogo exacto (alcohol) se admite su presentación fija confirmada. */
export function envaseCompra(l: { contenido_presentacion?:unknown;unidad_presentacion?:string|null;contenido_compra?:unknown;unidad_fuente?:string|null;unidad_compra?:string|null }, p?: { unidad_base?:string|null;contenido_compra?:unknown;presentacion_modo?:string|null }) {
  if(Number(l.contenido_presentacion)>0 && l.unidad_presentacion) return {contenido_presentacion:Number(l.contenido_presentacion),unidad_presentacion:l.unidad_presentacion};
  const unidad=(l.unidad_fuente??l.unidad_compra??'').trim().toLowerCase();
  if(p?.unidad_base!=='pieza' && p?.unidad_base && /^botellas?$/.test(unidad)) {
    const contenido=Number(l.contenido_compra??(p.presentacion_modo==='exacta'?p.contenido_compra:null));
    if(contenido>0) return {contenido_presentacion:contenido,unidad_presentacion:p.unidad_base};
  }
  return {contenido_presentacion:null,unidad_presentacion:null};
}
