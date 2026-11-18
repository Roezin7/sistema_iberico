/** Aperturas/ajustes son lotes, pero no recepciones de compras nuevas. */
export function lotesDeCompras<T extends {purchase_id?: number|null;fuente?:string}>(lotes:T[]) {
 return lotes.filter(l=>l.purchase_id!=null&&!['apertura_conciliada','inventario_inicial','regularizacion_estimada','ajuste_inventario','produccion_interna'].includes(l.fuente??''));
}
