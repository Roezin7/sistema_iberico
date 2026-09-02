import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Cargando } from '../../ui/Cargando';
import { Icono } from '../../icons';

interface SemanaDecision {
  semana_id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string; estado: string;
  ventas: number; costo_ventas: number | null; food_cost_pct: number | null;
  utilidad_operativa: number | null; margen_operativo_pct: number | null;
  compras_inventario: number; inventario_final: number | null; rotacion_semanal: number | null;
  cobertura_semanas: number | null; excepciones_costeo: number; ventas_epos_pendientes: number;
  incidencias_inventario: { producto: string; incidencia: string; tipo: string }[];
  resultado_independiente: boolean;
}
interface DecisionData {
  generado_at: string;
  semanas: SemanaDecision[];
  incidencias: { id: string; semana_id: number; semana: string; tipo: 'costeo' | 'inventario'; responsable: string; fecha_limite: string; accion: string; detalle: string }[];
  alertas: { tipo: string; severidad: 'media' | 'alta'; semana_id: number; mensaje: string; valor: number | null; referencia: number | null }[];
  salud: { semanas_consultadas: number; semanas_con_bloqueadores: number; incidencias_abiertas: number; alertas_activas: number };
}
interface SaludData {
  generado_at: string; estado: 'saludable' | 'operable_con_alertas' | 'requiere_atencion';
  catalogo: { productos_activos: number; sin_zona: number; sin_categoria: number; menu_activo: number; menu_sin_epos: number; menu_sin_receta: number };
  operacion: { compras_pendientes: number; ventas_pendientes: number; semanas_abiertas: number; snapshots_sin_semana: number };
  bloqueadores: string[]; advertencias: string[];
}

const money = (n: number | null) => n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const pct = (n: number | null) => n == null ? '—' : `${n.toFixed(1)}%`;

export default function Decisiones() {
  const [data, setData] = useState<DecisionData | null>(null);
  const [salud, setSalud] = useState<SaludData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<DecisionData>('/finanzas/tablero-decisiones?semanas=8'),
      api<SaludData>('/finanzas/salud-operativa').catch(() => null),
    ]).then(([decisiones, saludData]) => { setData(decisiones); setSalud(saludData); }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el tablero'));
  }, []);
  if (!data && !error) return <div className="page"><Cargando etiqueta="Cargando tablero de decisiones…" /></div>;
  if (error) return <div className="page"><div className="empty-state empty-state--error"><strong>No se pudo cargar Decisiones</strong><p>{error}</p></div></div>;
  if (!data) return null;
  return <div className="page decisiones-page">
    <header className="page-head"><div className="page-title"><Icono name="trending" size={24} className="ttl-icon" /><h1>Decisiones</h1></div><p className="muted">Ventas, costo, inventario e incidencias en una sola lectura para dirección.</p><span className="muted">Actualizado {new Date(data.generado_at).toLocaleString('es-MX')}</span></header>
    <section className="decision-health" aria-label="Salud del sistema"><div><small>Semanas consultadas</small><strong>{data.salud.semanas_consultadas}</strong></div><div><small>Con bloqueadores</small><strong className={data.salud.semanas_con_bloqueadores ? 'text-danger' : ''}>{data.salud.semanas_con_bloqueadores}</strong></div><div><small>Incidencias abiertas</small><strong className={data.salud.incidencias_abiertas ? 'text-danger' : ''}>{data.salud.incidencias_abiertas}</strong></div><div><small>Alertas activas</small><strong className={data.salud.alertas_activas ? 'text-danger' : ''}>{data.salud.alertas_activas}</strong></div></section>
    {salud && <section className={`card system-health system-health--${salud.estado}`} aria-labelledby="salud-operativa-titulo"><div className="section-heading"><div><span className="eyebrow">Preparación del sistema</span><h2 id="salud-operativa-titulo">{salud.estado === 'saludable' ? 'Sistema listo para decidir' : salud.estado === 'operable_con_alertas' ? 'Operable con alertas' : 'Requiere atención'}</h2><p className="muted">Catálogos, colas y semanas que pueden afectar la trazabilidad de los indicadores.</p></div><span className="chip">{salud.catalogo.productos_activos} productos activos · {salud.catalogo.menu_activo} productos de menú</span></div><div className="system-health__metrics"><span>Sin zona de conteo: <b>{salud.catalogo.sin_zona}</b></span><span>Sin categoría: <b>{salud.catalogo.sin_categoria}</b></span><span>Menú sin Epos: <b>{salud.catalogo.menu_sin_epos}</b></span><span>Menú sin receta: <b>{salud.catalogo.menu_sin_receta}</b></span><span>Compras pendientes: <b>{salud.operacion.compras_pendientes}</b></span><span>Ventas pendientes: <b>{salud.operacion.ventas_pendientes}</b></span></div>{salud.bloqueadores.length > 0 && <div className="system-health__list"><strong>Bloqueadores</strong>{salud.bloqueadores.map((x) => <span key={x}>• {x}</span>)}</div>}{salud.advertencias.length > 0 && <div className="system-health__list system-health__list--muted"><strong>Advertencias</strong>{salud.advertencias.map((x) => <span key={x}>• {x}</span>)}</div>}</section>}
    <section className="card decision-alerts"><div className="section-heading"><div><span className="eyebrow">Señales</span><h2>Alertas que requieren decisión</h2></div></div>{data.alertas.length === 0 ? <div className="aviso aviso--info"><Icono name="checkCircle" size={16} /> No hay alertas automáticas en el periodo consultado.</div> : <div className="decision-alert-list">{data.alertas.map((a, i) => <div className={`decision-alert decision-alert--${a.severidad}`} key={`${a.tipo}-${a.semana_id}-${i}`}><strong>{a.mensaje}</strong><small>{a.severidad === 'alta' ? 'Prioridad alta' : 'Revisar esta semana'}</small></div>)}</div>}</section>
    <section className="card decision-trend"><div className="section-heading"><div><span className="eyebrow">Comparativo</span><h2>Desempeño semanal</h2><p className="muted">El margen operativo es provisional cuando FIFO o Epos aún no están completamente verificados.</p></div><Link className="inline-link" to="/costos-menu">Ver menú y rentabilidad →</Link></div><div className="table-wrap"><table><thead><tr><th>Semana</th><th>Ventas</th><th>Food cost</th><th>Margen operativo</th><th>Rotación</th><th>Cobertura</th><th>Estado</th></tr></thead><tbody>{data.semanas.map((s) => <tr key={s.semana_id}><td><strong>{s.etiqueta}</strong>{s.estado === 'abierta' && <small className="muted"> · abierta</small>}</td><td>{money(s.ventas)}</td><td>{pct(s.food_cost_pct)}</td><td className={s.margen_operativo_pct != null && s.margen_operativo_pct < 0 ? 'text-danger' : ''}>{pct(s.margen_operativo_pct)}</td><td>{s.rotacion_semanal == null ? '—' : `${s.rotacion_semanal.toFixed(2)}×`}</td><td>{s.cobertura_semanas == null ? '—' : `${s.cobertura_semanas.toFixed(1)} sem.`}</td><td>{s.excepciones_costeo || s.ventas_epos_pendientes || s.incidencias_inventario.length ? <span className="chip chip--warn">Revisar</span> : <span className="chip chip--ok">Consistente</span>}</td></tr>)}</tbody></table></div></section>
    <section className="card decision-queue"><div className="section-heading"><div><span className="eyebrow">Seguimiento</span><h2>Cola de incidencias</h2><p className="muted">Responsable, fecha límite y acción sugerida para que ningún hallazgo se quede sólo como reporte.</p></div></div>{data.incidencias.length === 0 ? <p className="muted">No hay incidencias abiertas.</p> : <div className="decision-queue-list">{data.incidencias.map((i) => <article className="decision-queue-item" key={i.id}><div><strong>{i.detalle}</strong><small>{i.semana} · responsable: {i.responsable} · fecha límite: {i.fecha_limite}</small></div><span>{i.accion}</span></article>)}</div>}</section>
  </div>;
}
