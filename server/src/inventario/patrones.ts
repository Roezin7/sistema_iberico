const q4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

interface CasoPatron {
  product_id: number; producto: string; semana_id: number; origen: string;
  diferencia: number; causa: string; estado: string; valor: number | null;
  unidad?: string | null;
}
interface SalidaPatron {
  product_id: number; producto: string; semana_id: number; tipo: string;
  cantidad: number; valor: number; unidad?: string | null;
}
const causasDeCalidad = new Set(['error_conteo','error_presentacion','compra_omitida','venta_omitida','receta']);

/** Una tendencia documentada sigue siendo relevante, pero no es una tarea
 * sin explicar. Clasificar un caso nunca elimina su evidencia ni su tendencia. */
export function patronesInventario(casos: CasoPatron[], salidas: SalidaPatron[]) {
  const patrones = new Map<string, { producto:string; semanas:Set<number>; cantidad:number; valor:number; signo:string; causa:string; unidad?:string|null; pendientes:number; documentadas:number }>();
  function acumular(c: {product_id:number;producto:string;semana_id:number;cantidad:number;valor:number;causa:string;unidad?:string|null;documentada:boolean}) {
    if (!c.cantidad) return;
    const signo=c.cantidad<0?'faltante':'sobrante',key=`${c.product_id}:${signo}:${c.causa}`;
    const p=patrones.get(key)??{producto:c.producto,semanas:new Set<number>(),cantidad:0,valor:0,signo,causa:c.causa,unidad:c.unidad,pendientes:0,documentadas:0};
    p.semanas.add(c.semana_id);p.cantidad+=Math.abs(c.cantidad);p.valor+=c.valor;
    if(c.documentada)p.documentadas++;else p.pendientes++;
    patrones.set(key,p);
  }
  for(const c of casos)if(c.origen==='semanal'&&!causasDeCalidad.has(c.causa))acumular({...c,cantidad:c.diferencia,valor:c.valor??0,documentada:c.estado==='documentada'});
  for(const s of salidas)if(s.cantidad<0&&['merma','cortesia','consumo_interno'].includes(s.tipo))acumular({...s,causa:s.tipo,documentada:true});
  return [...patrones.values()].filter(p=>p.semanas.size>=2).map(p=>({
    ...p,semanas:[...p.semanas],cantidad:q4(p.cantidad),valor:q4(p.valor),
    estado:p.pendientes?'por_explicar' as const:'documentada' as const,
    mensaje:`${p.producto}: ${p.signo} en ${p.semanas.size} cierres distintos de los últimos cuatro. Causa: ${p.causa}.`,
  }));
}
