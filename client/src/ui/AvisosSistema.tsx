export interface PatronAviso {mensaje:string;estado?:'por_explicar'|'documentada';valor?:number;pendientes?:number}
export function separarAvisos(advertencias:string[],patrones?:PatronAviso[]) {
 const unicos=[...new Set(advertencias.map(s=>s.trim()).filter(Boolean))];
 const mensajesPatrones=new Set(patrones?.map(p=>p.mensaje));
 const recurrentes:PatronAviso[]=patrones??unicos.filter(s=>/cierres distintos/.test(s)).map(mensaje=>({mensaje}));
 return {operativos:unicos.filter(s=>!mensajesPatrones.has(s)&&(patrones!==undefined||!/cierres distintos/.test(s))),pendientes:recurrentes.filter(p=>p.estado!=='documentada'),documentados:recurrentes.filter(p=>p.estado==='documentada')};
}
/** Agrupa sin descartar: la lista completa permanece accesible en la misma vista. */
export function AvisosSistema({advertencias,patrones}:{advertencias:string[];patrones?:PatronAviso[]}) {
 const {operativos,pendientes,documentados}=separarAvisos(advertencias,patrones);
 const grupos=[{titulo:'Patrones históricos por explicar',items:pendientes},{titulo:'Tendencias documentadas',items:documentados}];
 return <>
  {!!operativos.length&&<div className="system-health__list system-health__list--muted"><strong>Advertencias operativas</strong>{operativos.map(s=><span key={s}>{s}</span>)}</div>}
  {grupos.filter(g=>g.items.length).map(g=><details className="alert-history" key={g.titulo}><summary>{g.titulo} · {g.items.length}</summary><p className="muted">Proceden de cierres anteriores; no son bloqueadores ni nuevas salidas de inventario. Clasificarlos no elimina una tendencia real.</p><div className="system-health__list system-health__list--muted">{[...g.items].sort((a,b)=>(b.valor??0)-(a.valor??0)).map((p,i)=><span key={`${p.mensaje}:${i}`}>{p.mensaje}</span>)}</div></details>)}
 </>;
}
