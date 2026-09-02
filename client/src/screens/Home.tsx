import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { Cargando } from '../ui/Cargando';
import { epos, finanzas, mxn, type ConciliacionDiaria, type DiaFila, type Resumen, type SaludOperativa, type Semana, type TableroSnapshot } from './finanzas/api';
import { weekLabel, weekStateLabel } from '../operating';

interface DashboardState {
  semana: Semana | null;
  dias: DiaFila[];
  conciliaciones: ConciliacionDiaria[];
  resumen: Resumen | null;
  salud: SaludOperativa | null;
  tablero: TableroSnapshot | null;
  cargando: boolean;
  error: string;
  actualizado: string | null;
}

const initialState: DashboardState = {
  semana: null, dias: [], conciliaciones: [], resumen: null, salud: null, tablero: null,
  cargando: true, error: '', actualizado: null,
};

function saludo() {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Mexico_City' }));
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function estadoSalud(salud: SaludOperativa | null) {
  if (!salud || salud.estado === 'saludable') return { label: 'Sistema listo', tone: 'ok' };
  if (salud.estado === 'operable_con_alertas') return { label: 'Operable con alertas', tone: 'warn' };
  return { label: 'Requiere atención', tone: 'danger' };
}

function EstadoPunto({ tone = 'neutral' }: { tone?: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return <span className={`dashboard-dot dashboard-dot--${tone}`} aria-hidden="true" />;
}

export default function Home() {
  const { usuario } = useAuth();
  const [recarga, setRecarga] = useState(0);
  const [estado, setEstado] = useState<DashboardState>(initialState);
  const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

  useEffect(() => {
    if (!usuario || usuario.rol !== 'admin') return;
    let activo = true;
    setEstado((prev) => ({ ...prev, cargando: true, error: '' }));
    void Promise.all([finanzas.semanaActual(), finanzas.saludOperativa(), finanzas.tableroDecisiones(8)])
      .then(async ([semana, salud, tablero]) => {
        if (!semana) return { semana: null, dias: [], conciliaciones: [], resumen: null, salud, tablero };
        const [dias, resumen, conciliaciones] = await Promise.all([
          finanzas.dias(semana.id),
          finanzas.resumen(semana.id),
          epos.conciliaciones(semana.id).catch(() => []),
        ]);
        return { semana, dias: dias.dias, conciliaciones, resumen, salud, tablero };
      })
      .then((data) => {
        if (activo) setEstado({ ...data, cargando: false, error: '', actualizado: new Date().toISOString() });
      })
      .catch((error) => {
        if (activo) setEstado((prev) => ({ ...prev, cargando: false, error: error instanceof Error ? error.message : 'No se pudo cargar el estado de Ibérico' }));
      });
    return () => { activo = false; };
  }, [usuario, hoyMx, recarga]);

  if (!usuario) return null;
  if (usuario.rol !== 'admin') {
    return <div className="page"><header className="page-head"><div><h1>{saludo()}, {usuario.nombre}</h1><p className="page-sub">Operación de Ibérico</p></div></header><section className="card dashboard-staff"><Icono name="checks" size={22} /><div><strong>Operación lista</strong><p className="muted">Registra entradas, inventario y checklist desde el menú.</p></div></section></div>;
  }

  const { semana, dias, conciliaciones, resumen, salud, tablero } = estado;
  const semanaCerrada = semana?.estado === 'cerrada';
  const diaSemana = new Date(`${hoyMx}T12:00:00`).getDay();
  const enSemana = Boolean(semana && hoyMx >= semana.fecha_inicio && hoyMx <= semana.fecha_fin);
  const esFinDeSemana = enSemana && (diaSemana === 0 || diaSemana === 5 || diaSemana === 6);
  const fase = !semana ? 'Sin semana' : semanaCerrada ? 'Cierre completado' : esFinDeSemana ? 'Operación' : 'Preparación';
  const corteHoy = conciliaciones.find((c) => c.fecha === hoyMx) ?? null;
  const ventas = resumen?.ventas_operativas ?? resumen?.ventas.total ?? null;
  const inventarioFisico = resumen?.inventario.valor_fisico_actual ?? resumen?.inventario.cierre_valor ?? resumen?.inventario.apertura_valor;
  const inventarioFisicoLabel = resumen?.inventario.valor_fisico_actual != null ? 'Inventario físico actual' : resumen?.inventario.apertura_valor != null ? 'Inventario físico base' : 'Inventario físico';
  const brecha = resumen?.inventario.diferencia_fifo_vs_fisico ?? null;
  const saludVisual = estadoSalud(salud);
  const accionRuta = !semana ? '/finanzas' : semanaCerrada ? `/finanzas?semana=${semana.id}&tab=resumen` : !esFinDeSemana ? '/compras' : `/finanzas?semana=${semana.id}&tab=dia`;
  const accionLabel = !semana ? 'Preparar semana' : semanaCerrada ? 'Ver resultado' : !esFinDeSemana ? 'Revisar preparación' : corteHoy ? 'Abrir operación' : 'Confirmar corte de hoy';
  const atenciones = [
    ...(salud?.bloqueadores ?? []).map((mensaje) => ({ tone: 'danger' as const, mensaje })),
    ...(salud?.advertencias ?? []).map((mensaje) => ({ tone: 'warn' as const, mensaje })),
    ...(tablero?.alertas ?? []).map((alerta) => ({ tone: alerta.severidad === 'alta' ? 'danger' as const : 'warn' as const, mensaje: alerta.mensaje })),
    ...(tablero?.incidencias ?? []).slice(0, 4).map((incidencia) => ({ tone: 'warn' as const, mensaje: incidencia.detalle })),
  ];
  const diasConVenta = dias.filter((fila) => fila.total_ventas > 0).length;
  const cortesConfirmados = conciliaciones.filter((c) => c.estado === 'confirmada' || c.confirmado_at).length;

  return <div className="page dashboard-page">
    <header className="page-head dashboard-head">
      <div><span className="eyebrow">Centro de mando</span><h1>{saludo()}, {usuario.nombre}</h1><p className="page-sub">Estado actual de Ibérico.</p></div>
      <div className="dashboard-head__actions"><span className="muted">{estado.actualizado ? `Actualizado ${new Date(estado.actualizado).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Sincronizando…'}</span><button className="btn-ghost" type="button" onClick={() => setRecarga((n) => n + 1)} disabled={estado.cargando}><Icono name="refresh" size={16} className={estado.cargando ? 'cargando__spin' : undefined} /> Actualizar</button></div>
    </header>

    {estado.error && <div className="empty-state empty-state--error"><strong>No se pudo actualizar el tablero</strong><p>{estado.error}</p></div>}
    {estado.cargando && !resumen ? <div className="card"><Cargando etiqueta="Actualizando…" /></div> : <>
      <section className={`dashboard-hero dashboard-hero--${saludVisual.tone}`}>
        <div><span className="eyebrow">{semana ? weekLabel(semana) : 'Semana actual'}</span><h2>{fase}</h2><p>{semanaCerrada ? 'Periodo cerrado.' : !semana ? 'Sin semana operativa.' : esFinDeSemana ? (corteHoy ? 'Corte confirmado.' : 'Corte pendiente.') : 'Preparación semanal.'}</p></div>
        <div className="dashboard-hero__right"><span className={`dashboard-status dashboard-status--${saludVisual.tone}`}><EstadoPunto tone={saludVisual.tone as 'ok' | 'warn' | 'danger'} /> {saludVisual.label}</span><Link className="btn-primary" to={accionRuta}>{accionLabel}</Link></div>
      </section>

      <section className="dashboard-kpis" aria-label="Indicadores de la semana">
        <article className="dashboard-kpi dashboard-kpi--primary"><span>Ventas de la semana</span><strong>{mxn(ventas)}</strong><small>{resumen?.ventas_operativas != null ? 'EPOS' : 'Captura provisional'}</small></article>
        <article className="dashboard-kpi"><span>Resultado operativo</span><strong className={resumen?.resultado_operativo != null && resumen.resultado_operativo < 0 ? 'text-danger' : ''}>{mxn(resumen?.resultado_operativo)}</strong><small>{resumen?.resultado_operativo_estado === 'verificado' ? `Verificado · ${resumen.utilidad_pct.toFixed(1)}%` : resumen?.resultado_operativo == null ? 'Al cierre' : 'Provisional'}</small></article>
        <article className="dashboard-kpi"><span>Compras de inventario</span><strong>{mxn(resumen?.compras_inventario)}</strong><small>Esta semana</small></article>
        <article className="dashboard-kpi"><span>{inventarioFisicoLabel}</span><strong>{mxn(inventarioFisico)}</strong><small>{resumen?.inventario.estado === 'cerrado' ? 'Conteo confirmado' : 'Fuente física'}</small></article>
        <article className="dashboard-kpi"><span>FIFO activo</span><strong>{mxn(resumen?.inventario.valor_fifo_corte)}</strong><small>Auditoría</small></article>
        <article className={`dashboard-kpi ${brecha != null && Math.abs(brecha) > 1 ? 'dashboard-kpi--warn' : ''}`}><span>Brecha físico vs FIFO</span><strong>{brecha == null ? 'Pendiente' : mxn(brecha)}</strong><small>{brecha == null ? 'Al cierre' : Math.abs(brecha) <= 1 ? 'Consistente' : 'Revisar'}</small></article>
      </section>

      <div className="dashboard-columns">
        <section className="card dashboard-pulse"><div className="section-heading"><div><span className="eyebrow">Pulso operativo</span><h2>Qué está pasando ahora</h2></div></div><div className="dashboard-pulse__rows">
          <div><span><EstadoPunto tone={semana ? 'ok' : 'warn'} /> Semana</span><strong>{semana ? `${weekLabel(semana)} · ${weekStateLabel(semana)}` : 'Sin semana activa'}</strong></div>
          <div><span><EstadoPunto tone={corteHoy ? 'ok' : esFinDeSemana ? 'warn' : 'neutral'} /> Corte de hoy</span><strong>{corteHoy ? 'Confirmado' : esFinDeSemana ? 'Pendiente' : 'No aplica fuera de operación'}</strong></div>
          <div><span><EstadoPunto tone={resumen?.inventario.estado === 'cerrado' ? 'ok' : 'warn'} /> Inventario físico</span><strong>{resumen?.inventario.estado === 'cerrado' ? 'Cierre confirmado' : 'Pendiente de cierre'}</strong></div>
          <div><span><EstadoPunto tone={resumen?.resultado_independiente ? 'ok' : 'warn'} /> Rentabilidad</span><strong>{resumen?.resultado_independiente ? 'Trazable' : 'Provisional hasta validar FIFO/EPOS'}</strong></div>
          <div><span><EstadoPunto tone={saludVisual.tone as 'ok' | 'warn' | 'danger'} /> Preparación del sistema</span><strong>{saludVisual.label}</strong></div>
        </div></section>

        <section className="card dashboard-activity"><div className="section-heading"><div><span className="eyebrow">Actividad</span><h2>Avance semanal</h2></div></div><div className="dashboard-activity__stats"><div><strong>{diasConVenta}</strong><span>días con venta</span></div><div><strong>{cortesConfirmados}</strong><span>cortes confirmados</span></div><div><strong>{resumen?.ventas_epos_pendientes ?? 0}</strong><span>ventas pendientes</span></div></div><p className="muted">Ventas regulares: vie–dom.</p><Link className="inline-link" to={semana ? `/finanzas?semana=${semana.id}&tab=dia` : '/finanzas'}>Abrir operación →</Link></section>
      </div>

      <section className="card dashboard-attention"><div className="section-heading"><div><span className="eyebrow">Control</span><h2>{atenciones.length ? 'Requiere decisión' : 'Sin pendientes críticos'}</h2><p className="muted">{atenciones.length ? 'Alertas actuales.' : 'Sin alertas actuales.'}</p></div><Link className="inline-link" to="/decisiones">Ver auditoría →</Link></div>{atenciones.length ? <div className="dashboard-attention__list">{atenciones.slice(0, 6).map((item, i) => <div className={`dashboard-attention__item dashboard-attention__item--${item.tone}`} key={`${item.mensaje}-${i}`}><EstadoPunto tone={item.tone} /><span>{item.mensaje}</span></div>)}</div> : <div className="aviso aviso--info"><Icono name="checkCircle" size={17} /> Sin alertas ni incidencias.</div>}</section>

      {tablero && <section className="card dashboard-trend"><div className="section-heading"><div><span className="eyebrow">Contexto</span><h2>Últimas semanas</h2><p className="muted">Comparativo reciente.</p></div><Link className="inline-link" to="/costos-menu">Ver rentabilidad →</Link></div><div className="table-wrap"><table><thead><tr><th>Semana</th><th>Ventas</th><th>Food cost</th><th>Resultado</th><th>Estado</th></tr></thead><tbody>{tablero.semanas.slice(-4).reverse().map((fila) => <tr key={fila.semana_id}><td><strong>{fila.etiqueta}</strong>{fila.estado === 'abierta' && <small className="muted"> · abierta</small>}</td><td>{mxn(fila.ventas)}</td><td>{fila.food_cost_pct == null ? '—' : `${fila.food_cost_pct.toFixed(1)}%`}</td><td className={fila.utilidad_operativa != null && fila.utilidad_operativa < 0 ? 'text-danger' : ''}>{mxn(fila.utilidad_operativa)}</td><td>{fila.excepciones_costeo || fila.ventas_epos_pendientes ? <span className="chip chip--warn">Revisar</span> : <span className="chip chip--ok">Consistente</span>}</td></tr>)}</tbody></table></div></section>}
    </>}
  </div>;
}
