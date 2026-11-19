export interface ResumenCasos {semana_id:number;estado:string;origen:string;total:number}
export function pendientesSemana(resumen:ResumenCasos[],semana:number,soloSemanal=false) {
 return resumen.filter(r=>r.semana_id===semana&&r.estado!=='documentada'&&(!soloSemanal||r.origen==='semanal')).reduce((s,r)=>s+r.total,0);
}
