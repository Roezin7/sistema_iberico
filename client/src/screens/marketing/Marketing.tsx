import { useEffect, useMemo, useState } from 'react';

type Estado = 'IDEA' | 'EN_EDICION' | 'ADAPTADO_BRANDBOOK' | 'BORRADOR' | 'APROBADO' | 'PROGRAMADO' | 'PUBLICADO' | 'PAUSAR';
type Pieza = { id: string; fecha: string; formato: string; pilar: string; titulo: string; asset: string; estado: Estado; caducidad: string; aprobadoPor: string; cta: string };

const KEY = 'iberico_marketing_cola_v2';
const PAUSE_KEY = 'iberico_marketing_pause_v1';
const semillas: Pieza[] = [
  { id: 'MKT-001', fecha: '', formato: 'IG Story 9:16', pilar: 'Producto', titulo: 'Bebida de barra · Story con imagotipo oficial', asset: 'v04_assets_originales.png', estado: 'ADAPTADO_BRANDBOOK', caducidad: '', aprobadoPor: '', cta: 'Guárdalo para tu próxima salida' },
  { id: 'MKT-002', fecha: '', formato: 'IG Story 9:16', pilar: 'Producto', titulo: 'Tinto de verano · Canva 09 para adaptar', asset: 'CANVA_comida_09_tinto_verano.png', estado: 'EN_EDICION', caducidad: '', aprobadoPor: '', cta: 'Guárdalo para tu próxima salida' },
  { id: 'MKT-003', fecha: '', formato: 'IG Story 9:16', pilar: 'Experiencia', titulo: 'Al fin viernes · Canva 13 para adaptar', asset: 'CANVA_comida_13_al_fin_viernes.png', estado: 'EN_EDICION', caducidad: '', aprobadoPor: '', cta: 'Etiqueta a tu grupo' },
];

function load<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }

export default function Marketing() {
  const [cola, setCola] = useState<Pieza[]>(() => load(KEY, semillas));
  const [pausado, setPausado] = useState(() => load(PAUSE_KEY, false));
  const [tab, setTab] = useState<'cola' | 'brief' | 'respuestas'>('cola');
  const [filtro, setFiltro] = useState<'todos' | Estado>('todos');
  const [guardado, setGuardado] = useState(false);

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(cola)); }, [cola]);
  useEffect(() => { localStorage.setItem(PAUSE_KEY, JSON.stringify(pausado)); }, [pausado]);

  const visibles = useMemo(() => filtro === 'todos' ? cola : cola.filter((p) => p.estado === filtro), [cola, filtro]);
  const actualizar = (id: string, cambios: Partial<Pieza>) => setCola((items) => items.map((p) => p.id === id ? { ...p, ...cambios } : p));
  const avanzar = (p: Pieza) => {
    const siguiente: Record<Estado, Estado> = { IDEA: 'EN_EDICION', EN_EDICION: 'ADAPTADO_BRANDBOOK', ADAPTADO_BRANDBOOK: 'BORRADOR', BORRADOR: 'APROBADO', APROBADO: 'PROGRAMADO', PROGRAMADO: 'PUBLICADO', PUBLICADO: 'PUBLICADO', PAUSAR: 'BORRADOR' };
    const destino = siguiente[p.estado];
    if (pausado || !p.asset || !p.cta || (destino === 'PROGRAMADO' && !p.fecha)) return;
    actualizar(p.id, { estado: destino, aprobadoPor: destino === 'APROBADO' ? 'Admin' : p.aprobadoPor });
  };

  return <div className="page">
    <header className="page-head"><div className="page-title"><span className="ttl-icon" aria-hidden="true">✦</span><h1>Marketing</h1></div><span className={pausado ? 'badge-warn' : 'badge-ok'}>{pausado ? 'PAUSADO' : 'OPERATIVO'}</span></header>
    <div className="resumen-card marketing-alert"><strong>{pausado ? 'La cola está pausada' : 'Cola bajo control'}</strong><span>{pausado ? 'No programes ni publiques hasta resolver la incidencia.' : 'Toda pieza debe pasar por edición, aprobación y control de disponibilidad.'}</span><button className={pausado ? 'btn-primary' : 'pill'} onClick={() => setPausado(!pausado)}>{pausado ? 'Reanudar cola' : 'Pausar por emergencia'}</button></div>
    <nav className="tabs"><button className={tab === 'cola' ? 'tab tab--on' : 'tab'} onClick={() => setTab('cola')}>Cola</button><button className={tab === 'brief' ? 'tab tab--on' : 'tab'} onClick={() => setTab('brief')}>Brief semanal</button><button className={tab === 'respuestas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('respuestas')}>Respuestas rápidas</button></nav>
    {tab === 'cola' && <>
      <div className="marketing-toolbar"><select value={filtro} onChange={(e) => setFiltro(e.target.value as 'todos' | Estado)}><option value="todos">Todos los estados</option>{['IDEA','EN_EDICION','ADAPTADO_BRANDBOOK','BORRADOR','APROBADO','PROGRAMADO','PUBLICADO','PAUSAR'].map((s) => <option key={s} value={s}>{s}</option>)}</select><span className="muted">{cola.length} piezas · {cola.filter((p) => p.estado === 'APROBADO' || p.estado === 'PROGRAMADO').length} listas para publicar</span></div>
      {visibles.map((p) => <PiezaCard key={p.id} pieza={p} pausado={pausado} onChange={actualizar} onAdvance={avanzar} />)}
      <button className="btn-primary" onClick={() => setCola((items) => [...items, { id: `MKT-${String(items.length + 1).padStart(3, '0')}`, fecha: '', formato: 'IG Story 9:16', pilar: 'Producto', titulo: 'Nueva pieza', asset: '', estado: 'IDEA', caducidad: '', aprobadoPor: '', cta: '' }])}>+ Agregar pieza</button>
    </>}
    {tab === 'brief' && <Brief guardado={guardado} setGuardado={setGuardado} />}
    {tab === 'respuestas' && <Respuestas />}
  </div>;
}

function PiezaCard({ pieza: p, pausado, onChange, onAdvance }: { pieza: Pieza; pausado: boolean; onChange: (id: string, c: Partial<Pieza>) => void; onAdvance: (p: Pieza) => void }) {
  const destino: Estado = ({ IDEA: 'EN_EDICION', EN_EDICION: 'ADAPTADO_BRANDBOOK', ADAPTADO_BRANDBOOK: 'BORRADOR', BORRADOR: 'APROBADO', APROBADO: 'PROGRAMADO', PROGRAMADO: 'PUBLICADO', PUBLICADO: 'PUBLICADO', PAUSAR: 'BORRADOR' } as Record<Estado, Estado>)[p.estado];
  const bloqueada = pausado || !p.asset || !p.cta || (destino === 'PROGRAMADO' && !p.fecha);
  const motivo = pausado ? 'La cola está pausada' : !p.asset ? 'Falta el asset final' : !p.cta ? 'Falta el CTA' : destino === 'PROGRAMADO' && !p.fecha ? 'Agrega fecha y hora para programar' : '';
  return <article className="resumen-card marketing-piece"><div className="kv"><div><strong>{p.id} · {p.titulo}</strong><span className="muted">{p.formato} · {p.pilar}</span></div><span className={p.estado === 'APROBADO' || p.estado === 'PROGRAMADO' ? 'badge-ok' : p.estado === 'PAUSAR' ? 'badge-warn' : 'badge-neutral'}>{p.estado}</span></div><div className="marketing-fields"><label>Fecha/hora<input type="datetime-local" value={p.fecha} onChange={(e) => onChange(p.id, { fecha: e.target.value })} /></label><label>Asset final<input placeholder="Ruta o nombre del asset" value={p.asset} onChange={(e) => onChange(p.id, { asset: e.target.value })} /></label><label>CTA<input value={p.cta} onChange={(e) => onChange(p.id, { cta: e.target.value })} /></label><label>Caducidad<input type="date" value={p.caducidad} onChange={(e) => onChange(p.id, { caducidad: e.target.value })} /></label></div><div className="marketing-actions"><button className="pill" onClick={() => onChange(p.id, { estado: 'PAUSAR' })}>Pausar pieza</button><button className="btn-primary" disabled={bloqueada || p.estado === 'PUBLICADO'} title={bloqueada ? motivo : ''} onClick={() => onAdvance(p)}>{p.estado === 'BORRADOR' ? 'Aprobar' : p.estado === 'APROBADO' ? 'Marcar programada' : p.estado === 'PROGRAMADO' ? 'Marcar publicada' : 'Avanzar estado'}</button></div></article>;
}

function Brief({ guardado, setGuardado }: { guardado: boolean; setGuardado: (v: boolean) => void }) { const [texto, setTexto] = useState(() => load('iberico_marketing_brief_v1', '')); return <div className="resumen-card"><h2>Brief semanal operativo</h2><p className="muted">Completa horarios, eventos, disponibilidad y producto prioritario. Sin esto no se aprueba la cola.</p><textarea rows={14} value={texto} onChange={(e) => { setTexto(e.target.value); setGuardado(false); }} placeholder={'Días abiertos:\nHorarios confirmados:\nEvento/partido:\nProductos disponibles:\nProducto rentable a priorizar:\nPromoción autorizada y vigencia:\nCambios o pausas:'} /><button className="btn-primary" onClick={() => { localStorage.setItem('iberico_marketing_brief_v1', texto); setGuardado(true); }}>{guardado ? 'Guardado ✓' : 'Guardar brief'}</button></div>; }

function Respuestas() { const respuestas = [['Horario', '¡Hola! Gracias por escribirnos. Nuestro horario confirmado esta semana es [HORARIO]. Te recomendamos confirmar disponibilidad antes de salir.'], ['Carta', 'Con gusto te compartimos la carta vigente: [ENLACE]. Los productos y precios pueden cambiar según disponibilidad.'], ['Reserva', 'Para confirmar necesitamos fecha, hora, número de personas y nombre. Revisamos disponibilidad y te respondemos.'], ['Queja', 'Lamentamos que tu experiencia no haya sido la esperada. Queremos revisarlo personalmente. ¿Nos compartes fecha, hora y una forma de contactarte?']]; return <div className="resumen-card"><h2>Respuestas rápidas</h2><p className="muted">Usa solo datos confirmados. Reclamos, cobros, seguridad y colaboraciones se escalan a un socio.</p>{respuestas.map(([t, r]) => <div className="response-row" key={t}><strong>{t}</strong><span>{r}</span><button className="pill" onClick={() => void navigator.clipboard?.writeText(r)}>Copiar</button></div>)}</div>; }
