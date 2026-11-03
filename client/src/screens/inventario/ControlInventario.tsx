import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useConfirm } from '../../ui/ConfirmProvider';
import { inputHoraMexico, isoDesdeHoraMexico } from '../../operating';

const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 4 });
const money = (n: number | null) => n == null ? 'Costo pendiente' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const causas = ['sin_explicar','merma','cortesia','consumo_interno','error_conteo','error_presentacion','compra_omitida','venta_omitida','receta','arrastre_previo'];
const label = (s: string) => (({cortesia:'cortesía',produccion:'producción',consumo_interno:'consumo interno',sin_explicar:'sin explicar',error_presentacion:'error de presentación',error_conteo:'error de conteo',compra_omitida:'compra omitida',venta_omitida:'venta omitida',arrastre_previo:'brecha anterior'} as Record<string,string>)[s]??s.replaceAll('_', ' '));
type Fila = { product_id: number; producto: string; unidad: string; esperado: number; contado: number; diferencia: number; arrastre_previo: number; costo_estimado: boolean; no_cubierto: number };
type Preview = { revision?:string; pendiente_conteo?:boolean; faltantes?:{product_id:number;producto:string;zona_id:number;zona:string;unidad:string}[]; confirmada: boolean; snapshot_id: number; corte_at: string; filas: Fila[]; advertencias: { mensaje: string }[] };
type Caso = { id: number; semana_id: number; producto: string; unidad: string; origen: string; diferencia: number; valor: number | null; costo_estimado: boolean; causa: string; estado: string; responsable: string | null; nota: string | null; evidencia: string | null; version: number };
type Control = { ventas_tardias?:{semana_id:number;ventas:number}[]; casos: Caso[]; alertas: { mensaje: string; cantidad: number; unidad: string; valor: number }[]; criterio_alerta: string; operaciones: { id: number; tipo: string; efectiva_at: string; motivo: string; pendiente_costo?: boolean }[] };

export function ControlCiclo({ semanaId, onCambio }: { semanaId: number; onCambio?: () => void }) {
  const { usuario } = useAuth();
  const confirmar = useConfirm();
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const lectura=useRef(0);
  const [busy, setBusy] = useState(false);
  const [omitidas,setOmitidas]=useState<Record<string,string>>({});
  async function cargar() { const version=++lectura.current;setData(null);setError('');try { const nuevo=await api<Preview>(`/inventario/control/${semanaId}`);if(lectura.current===version)setData(nuevo); } catch(e) { if(lectura.current===version)setError(e instanceof Error ? e.message : 'No se pudo revisar el cierre'); } }
  useEffect(() => { if (usuario?.rol === 'admin') void cargar();return()=>{lectura.current++;}; }, [semanaId, usuario?.rol]);
  if (usuario?.rol !== 'admin') return null;
  const diferencias = data?.filas.filter(f => Math.abs(f.diferencia) > 0.0001) ?? [];
  return <section className="card inventory-control" aria-label="Conciliación del ciclo físico">
    <div className="inventory-control__head"><h3>Ciclo físico y FIFO</h3><button className="link-btn" disabled={busy} onClick={cargar}>Actualizar revisión</button></div>
    {!data ? <p className="muted" role="status">{error || 'Revisando apertura, movimientos y cierre…'}</p> : data.pendiente_conteo ? <form className="inventory-control__form" onSubmit={async e=>{e.preventDefault(); if(!await confirmar({message:'¿Estas cantidades corresponden al mismo conteo físico de cierre? No ingreses existencias actuales de otra fecha. Se conserva el original y sus horas.',confirmText:'Completar conteo original'}))return;setBusy(true);try{await api(`/inventario/control/${semanaId}/completar-conteo`,{method:'POST',body:{snapshot_id:data.snapshot_id,confirmar_mismo_conteo:true,lineas:(data.faltantes??[]).map(f=>({product_id:f.product_id,zona_id:f.zona_id,cantidad_base:Number(omitidas[`${f.product_id}:${f.zona_id}`])}))}});await cargar();onCambio?.();}catch(e){setError(e instanceof Error?e.message:'No se pudo completar');}finally{setBusy(false);}}}>
      <p>Faltan {data.faltantes?.length} cantidades explícitas. No contado no equivale a cero. Completa sólo si conoces lo que había al cierre original.</p>
      {data.faltantes?.map(f=><label key={`${f.product_id}:${f.zona_id}`}>{f.producto} · {f.zona} ({f.unidad})<input required type="number" min="0" step="any" value={omitidas[`${f.product_id}:${f.zona_id}`]??''} placeholder="Sin contar" onChange={e=>setOmitidas(v=>({...v,[`${f.product_id}:${f.zona_id}`]:e.target.value}))}/></label>)}
      <button className="btn-primary" disabled={busy}>Completar cantidades del cierre</button>{error&&<p role="alert">{error}</p>}
    </form> : <>
      <p>{data.confirmada ? 'Conciliado. La siguiente apertura parte del físico y los movimientos hasta el corte.' : 'El cierre físico reinicia la base del siguiente ciclo. Las diferencias se documentan; no bloquean la continuidad.'}</p>
      <p className="muted">Corte: {new Date(data.corte_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} · {diferencias.length} productos con diferencia semanal.</p>
      <p className="muted">Se conservan costo y antigüedad de las capas supervivientes. Los sobrantes sin evidencia de compra llevan costo estimado, nunca costo cero confirmado. No mueve dinero ni confirma Banco.</p>
      {!!data.advertencias.length && <p className="info-box">{data.advertencias.length} advertencias de calidad (receta, conversión u hora histórica sin evidencia). La existencia física puede continuar; el costo permanece provisional.</p>}
      <details><summary>Ver cantidades y diferencias</summary><div className="inventory-control__table"><table><thead><tr><th>Producto</th><th>Esperado</th><th>Físico al corte</th><th>Diferencia nueva</th><th>Brecha previa</th></tr></thead><tbody>{data.filas.filter(f=>Math.abs(f.diferencia)>0.0001 || Math.abs(f.arrastre_previo)>0.0001 || f.no_cubierto>0).map(f=><tr key={f.product_id}><td>{f.producto}<small className="muted"> {f.unidad}</small></td><td>{num(f.esperado)}</td><td>{num(f.contado)}</td><td>{num(f.diferencia)}</td><td>{num(f.arrastre_previo)}</td></tr>)}</tbody></table></div><small className="muted">La brecha previa se separa: no se presenta como pérdida nueva de esta semana.</small></details>
      {!data.confirmada && <button className="btn-primary" disabled={busy} onClick={async()=>{
        if (!await confirmar({ message: '¿Conciliar este inventario? Se documentan diferencias y se crea la siguiente apertura con lotes trazables. No cierra las finanzas ni modifica pagos o arqueos. El corte queda protegido contra cambios retroactivos.', confirmText: 'Conciliar y preparar apertura' })) return;
        setBusy(true); try { await api(`/inventario/control/${semanaId}/confirmar`, { method:'POST', body:{ snapshot_id:data.snapshot_id, solicitud_id:crypto.randomUUID(), revision:data.revision,corte_at:data.corte_at, confirmar_diferencias:true } }); await cargar(); onCambio?.(); } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo conciliar'); } finally { setBusy(false); }
      }}>{busy ? 'Conciliando…' : 'Conciliar y preparar siguiente apertura'}</button>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}

function Incidencia({ caso:c, onCambio }: { caso: Caso; onCambio:()=>void }) {
  const [causa, setCausa] = useState(c.causa), [estado,setEstado] = useState(c.estado), [responsable,setResponsable] = useState(c.responsable ?? ''), [nota,setNota] = useState(c.nota ?? ''), [evidencia,setEvidencia] = useState(c.evidencia ?? '');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  return <details className="inventory-case"><summary><span>{c.producto} · {num(c.diferencia)} {c.unidad}</span><small>{c.origen === 'arrastre_previo' ? 'Brecha anterior' : 'Diferencia semanal'} · {label(c.causa)} · {label(c.estado)} · {money(c.valor)}{c.costo_estimado ? ' (estimado)' : ''}</small></summary>
    <form className="inventory-control__form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try {await api(`/inventario/incidencias/${c.id}`,{method:'PATCH',body:{version:c.version,causa,estado,responsable,nota,evidencia}});onCambio();}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar');}finally{setBusy(false);}}}>
      <p className="muted">Clasificar explica la diferencia; no descuenta inventario por segunda vez.</p>
      <label>Causa<select aria-label="Causa" value={causa} onChange={e=>setCausa(e.target.value)}>{causas.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
      <label>Estado<select aria-label="Estado" value={estado} onChange={e=>setEstado(e.target.value)}>{['abierta','investigando','documentada'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
      <label>Responsable<input required maxLength={150} value={responsable} onChange={e=>setResponsable(e.target.value)}/></label>
      <label>Explicación<textarea required minLength={5} maxLength={2000} value={nota} onChange={e=>setNota(e.target.value)}/></label>
      <label>Evidencia o referencia<input maxLength={1000} value={evidencia} onChange={e=>setEvidencia(e.target.value)}/></label>
      <button className="btn-primary" disabled={busy}>{busy?'Guardando…':'Guardar explicación'}</button>{error&&<p role="alert">{error}</p>}
    </form>
  </details>;
}

function SalidaInventario({ onCambio }: { onCambio:()=>void }) {
  type Producto = { id:number; nombre:string; unidad_base:string };
  const [productos,setProductos]=useState<Producto[]>([]), [zonas,setZonas]=useState<{id:number;nombre:string}[]>([]);
  const [tipo,setTipo]=useState('merma'), [hora,setHora]=useState(()=>inputHoraMexico(new Date().toISOString())), [motivo,setMotivo]=useState(''), [responsable,setResponsable]=useState('');
  const [lineas,setLineas]=useState([{product_id:'',zona_id:'',cantidad:'',entrada:false}]);
  const [busy,setBusy]=useState(false),[mensaje,setMensaje]=useState('');
  const [solicitud,setSolicitud]=useState(()=>crypto.randomUUID());
  useEffect(()=>{Promise.all([api<Producto[]>('/catalogo/products'),api<{id:number;nombre:string}[]>('/catalogo/zonas')]).then(([p,z])=>{setProductos(p);setZonas(z);}).catch(()=>setMensaje('No se pudieron cargar productos y zonas'));},[]);
  return <details id="salida-inventario" open={new URLSearchParams(window.location.search).get('registro')==='salida'} className="card inventory-control"><summary><strong>Registrar merma, cortesía o producción</strong><small className="muted">Sólo salidas no registradas en Epos; sin movimiento de Caja.</small></summary>
    <form className="inventory-control__form" onSubmit={async e=>{e.preventDefault();setBusy(true);setMensaje('');try{const r=await api<{pendiente_costo:boolean}>('/inventario/operaciones',{method:'POST',body:{tipo,efectiva_at:isoDesdeHoraMexico(hora),motivo,responsable,solicitud_id:solicitud,lineas:lineas.map(l=>({product_id:Number(l.product_id),zona_id:Number(l.zona_id),cantidad:Math.abs(Number(l.cantidad))*(tipo==='produccion'&&l.entrada?1:-1)}))}});setMensaje(r.pendiente_costo?'Guardado. Hay costo pendiente; revisa sus lotes, no repitas la salida.':'Guardado una vez en físico y FIFO; sin egreso de dinero.');setLineas([{product_id:'',zona_id:'',cantidad:'',entrada:false}]);setMotivo('');setSolicitud(crypto.randomUUID());onCambio();}catch(e){setMensaje(e instanceof Error?e.message:'No se pudo guardar');}finally{setBusy(false);}}}>
      <label>Movimiento<select aria-label="Movimiento" value={tipo} onChange={e=>setTipo(e.target.value)}>{['merma','cortesia','consumo_interno','produccion'].map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>
      <label>Fecha y hora real (México)<input required type="datetime-local" value={hora} onChange={e=>setHora(e.target.value)}/></label>
      {tipo==='produccion'&&<p className="muted">Agrega ingredientes que salen y un solo producto obtenido. Ejemplo: 3 lotes de mermelada de 400 g = 1,200 g obtenidos.</p>}
      {lineas.map((l,i)=><div className="inventory-control__line" key={i}>
        <label>Producto<select aria-label="Producto" required value={l.product_id} onChange={e=>setLineas(v=>v.map((x,j)=>j===i?{...x,product_id:e.target.value}:x))}><option value="">Seleccionar…</option>{productos.map(p=><option key={p.id} value={p.id}>{p.nombre} ({p.unidad_base})</option>)}</select></label>
        <label>Zona<select aria-label="Zona" required value={l.zona_id} onChange={e=>setLineas(v=>v.map((x,j)=>j===i?{...x,zona_id:e.target.value}:x))}><option value="">Seleccionar…</option>{zonas.map(z=><option key={z.id} value={z.id}>{z.nombre}</option>)}</select></label>
        <label>Cantidad en {productos.find(p=>p.id===Number(l.product_id))?.unidad_base ?? 'unidad base'}<input required min="0.0001" step="any" type="number" value={l.cantidad} onChange={e=>setLineas(v=>v.map((x,j)=>j===i?{...x,cantidad:e.target.value}:x))}/></label>
        {tipo==='produccion'&&<label>Dirección<select aria-label="Dirección" value={l.entrada?'entrada':'salida'} onChange={e=>setLineas(v=>v.map((x,j)=>j===i?{...x,entrada:e.target.value==='entrada'}:x))}><option value="salida">Ingrediente consumido</option><option value="entrada">Producto obtenido</option></select></label>}
        {lineas.length>1&&<button type="button" className="link-btn" onClick={()=>setLineas(v=>v.filter((_,j)=>j!==i))}>Quitar</button>}
      </div>)}
      <button type="button" className="btn-ghost" onClick={()=>setLineas(v=>[...v,{product_id:'',zona_id:'',cantidad:'',entrada:false}])}>Agregar producto</button>
      <label>Motivo<input required minLength={3} maxLength={500} value={motivo} onChange={e=>setMotivo(e.target.value)}/></label>
      <label>Responsable<input required maxLength={150} value={responsable} onChange={e=>setResponsable(e.target.value)}/></label>
      <button className="btn-primary" disabled={busy}>{busy?'Guardando…':'Registrar movimiento sin pago'}</button><p role="status">{mensaje}</p>
    </form>
  </details>;
}

export default function ControlInventario() {
  const {usuario}=useAuth(); const [semanas,setSemanas]=useState<{id:number;etiqueta:string}[]>([]),[semana,setSemana]=useState(''),[data,setData]=useState<Control|null>(null),[error,setError]=useState('');
  const [verHistoricas,setVerHistoricas]=useState(false),[version,setVersion]=useState(0);
  async function cargar(){try{setData(await api<Control>('/inventario/control'));setError('');}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar seguimiento');}}
  useEffect(()=>{if(usuario?.rol==='admin'){void cargar();api<{id:number;etiqueta:string}[]>('/finanzas/semanas').then(s=>{setSemanas(s);setSemana(v=>v||String(s[0]?.id??''));}).catch(()=>{});}},[usuario?.rol,version]);
  if(usuario?.rol!=='admin')return null;
  return <>
    <details className="card inventory-control"><summary><strong>Cierre y siguiente apertura</strong><small className="muted">Conciliar por semana sin esperar el cierre bancario.</small></summary><label>Semana<select aria-label="Semana" value={semana} onChange={e=>setSemana(e.target.value)}>{semanas.map(s=><option key={s.id} value={s.id}>{s.etiqueta}</option>)}</select></label>{semana&&<ControlCiclo key={`${semana}:${version}`} semanaId={Number(semana)} onCambio={()=>{setVersion(v=>v+1);window.dispatchEvent(new Event('iberico-inventario-cambio'));}}/>}</details>
    <SalidaInventario onCambio={()=>{void cargar();window.dispatchEvent(new Event('iberico-inventario-cambio'));}}/>
    <details className="card inventory-control"><summary><strong>Diferencias documentadas y alertas</strong><small className="muted">{data?.casos.filter(c=>c.estado!=='documentada'&&c.origen==='semanal'&&c.semana_id===Number(semana)).length??0} diferencias semanales por explicar en la semana seleccionada · no bloquean el cierre.</small></summary>
      {error&&<p role="alert">{error}</p>}{data?.ventas_tardias?.map(v=><p className="info-box" key={v.semana_id}>{v.ventas} ventas llegaron después de conciliar la semana {v.semana_id}. No reducen otra vez el inventario físico. Revisa la explicación de la diferencia y su costo histórico.</p>)}{data?.alertas.map((a,i)=><p className="info-box" key={i}>{a.mensaje} {num(a.cantidad)} {a.unidad} · {money(a.valor)}</p>)}<p className="muted">{data?.criterio_alerta}</p>
      <label>Semana<select aria-label="Semana" value={semana} onChange={e=>setSemana(e.target.value)}>{semanas.map(s=><option key={s.id} value={s.id}>{s.etiqueta}</option>)}</select></label>
      <label><input type="checkbox" checked={verHistoricas} onChange={e=>setVerHistoricas(e.target.checked)}/> Incluir brecha anterior al ciclo (no es pérdida semanal nueva)</label>
      {data?.casos.filter(c=>c.semana_id===Number(semana)&&(verHistoricas||c.origen==='semanal')).sort((a,b)=>(b.valor??0)-(a.valor??0)).map(c=><Incidencia key={`${c.id}:${c.version}`} caso={c} onCambio={cargar}/>)}
      {data&&!data.casos.some(c=>c.semana_id===Number(semana))&&<p className="muted">Sin diferencias documentadas para esta semana. Se crean al conciliar su cierre físico.</p>}
      <details><summary>Últimos movimientos sin pago</summary>{data?.operaciones.map(o=><p key={o.id}>{label(o.tipo)} · {o.motivo} · {new Date(o.efectiva_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}{o.pendiente_costo?' · costo pendiente':''}</p>)}</details>
    </details>
  </>;
}
