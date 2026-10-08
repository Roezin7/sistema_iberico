import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { Cargando } from '../ui/Cargando';
import { epos, finanzas, mxn, type ConciliacionDiaria, type DiaFila, type Resumen, type SaludOperativa, type Semana } from './finanzas/api';
import { todayMexico, weekLabel, weekStateLabel } from '../operating';

interface DashboardState { semana: Semana | null; resumen: Resumen | null; salud: SaludOperativa | null; dias: DiaFila[]; conciliaciones: ConciliacionDiaria[]; cargando: boolean; error: string; actualizado: string | null }
const initial: DashboardState = { semana: null, resumen: null, salud: null, dias: [], conciliaciones: [], cargando: true, error: '', actualizado: null };

function saludo() {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Mexico_City' }));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

type Tone = 'success' | 'warning' | 'danger' | 'info';
interface Action { id: string; title: string; description: string; href: string; tone: Tone; label: string }

/** Convierte un diagnóstico en el destino exacto donde se corrige. */
function destinoProblema(description: string) {
  const texto = description.toLocaleLowerCase('es-MX');
  if (texto.includes('sin zona')) return '/configuracion?tab=inventario&calidad=sin_zona&focus=zona';
  if (texto.includes('sin categoría') || texto.includes('sin categoria')) return '/configuracion?tab=inventario&calidad=sin_categoria&focus=categoria';
  if (texto.includes('sin receta')) return '/configuracion?tab=recetas&calidad=sin_receta';
  if (texto.includes('venta') && (texto.includes('epos') || texto.includes('pendiente'))) return '/compras?tab=epos&focus=ventas-pendientes';
  if (texto.includes('compra') && texto.includes('pendiente')) return '/compras?tab=pendientes&focus=compras-pendientes';
  return '/decisiones';
}

function buildActions(salud: SaludOperativa | null, semana: Semana | null, resumen: Resumen | null, cortes: ConciliacionDiaria[]): Action[] {
  const rows: Action[] = [];
  (salud?.bloqueadores ?? []).slice(0, 2).forEach((description, i) => rows.push({ id: `block-${i}`, title: 'Resolver bloqueador', description, href: destinoProblema(description), tone: 'danger', label: 'Corregir ahora' }));
  if (resumen?.ventas_epos_pendientes) rows.push({ id: 'pending-sales', title: 'Revisar ventas pendientes', description: `${resumen.ventas_epos_pendientes} ventas aún no tienen costeo completo.`, href: '/compras?tab=epos&focus=ventas-pendientes', tone: 'warning', label: 'Corregir ahora' });
  if (semana && resumen?.inventario.estado !== 'cerrado') rows.push({ id: 'inventory', title: 'Confirmar inventario', description: 'La existencia física debe confirmar el consumo teórico.', href: `/inventario?tipo=cierre&semana=${semana.id}`, tone: 'warning', label: 'Contar' });
  if (semana && cortes.every((c) => c.fecha !== todayMexico())) rows.push({ id: 'cut', title: 'Confirmar corte de hoy', description: 'Sincroniza Epos y valida los métodos de pago.', href: `/finanzas?semana=${semana.id}&tab=dia`, tone: 'info', label: 'Abrir corte' });
  if (!rows.length) rows.push({ id: 'ok', title: 'Todo en orden', description: 'No hay acciones críticas. Continúa con la operación del día.', href: '/operacion', tone: 'success', label: 'Abrir operación' });
  return rows.slice(0, 4);
}

export default function Home() {
  const { usuario } = useAuth();
  const admin = usuario?.rol === 'admin';
  const [state, setState] = useState<DashboardState>(initial);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!usuario) return;
    let live = true;
    setState((previous) => ({ ...previous, cargando: true, error: '' }));
    if (!admin) { setState((previous) => ({ ...previous, cargando: false, actualizado: new Date().toISOString() })); return () => { live = false; }; }
    void Promise.all([finanzas.semanaActual(), finanzas.saludOperativa()]).then(([semana, salud]) => {
      if (!live) return;
      setState((previous) => ({ ...previous, semana, salud, cargando: false, error: '', actualizado: new Date().toISOString() }));
      if (!semana) return;
      void Promise.all([finanzas.resumen(semana.id), finanzas.dias(semana.id), epos.conciliaciones(semana.id).catch(() => [])]).then(([resumen, dias, cortes]) => {
        if (live) setState((previous) => ({ ...previous, resumen, dias: dias.dias, conciliaciones: cortes }));
      }).catch((e) => { if (live) setState((previous) => ({ ...previous, error: e instanceof Error ? `Semana: ${e.message}` : 'No se pudo leer el resumen de la semana.' })); });
    }).catch((e) => { if (live) setState((previous) => ({ ...previous, cargando: false, error: e instanceof Error ? e.message : 'No se pudo cargar el inicio.' })); });
    return () => { live = false; };
  }, [admin, usuario, reload]);

  const actions = useMemo(() => buildActions(state.salud, state.semana, state.resumen, state.conciliaciones), [state.salud, state.semana, state.resumen, state.conciliaciones]);
  if (!usuario) return null;
  if (!admin) return <div className="page home-simple"><header className="page-head"><span className="eyebrow">Espacio de trabajo</span><h1>{saludo()}, {usuario.nombre}</h1><p className="page-sub">La operación está lista para continuar.</p></header><section className="home-staff-card"><div className="home-staff-card__icon"><Icono name="sunrise" size={22} /></div><div><h2>Comienza por Operación</h2><p>Ventas, inventario, compras y checklist en un solo flujo.</p><Link className="btn-primary" to="/operacion">Abrir operación</Link></div></section></div>;

  const { semana, resumen, salud, dias, conciliaciones } = state;
  const healthTone: Tone = salud?.estado === 'requiere_atencion' ? 'danger' : salud?.estado === 'operable_con_alertas' ? 'warning' : 'success';
  const healthText = healthTone === 'danger' ? 'Requiere atención' : healthTone === 'warning' ? 'Operable con alertas' : 'Sistema listo';
  const ventasHoy = dias.find((d) => d.fecha === todayMexico());
  const cortes = conciliaciones.filter((c) => c.estado === 'confirmada' || c.confirmado_at).length;
  return <div className="page home-page">
    <header className="page-head home-head"><div><span className="eyebrow">Centro de mando</span><h1>{saludo()}, {usuario.nombre}</h1><p className="page-sub">La vista corta para decidir qué sigue en Ibérico.</p></div><div className="page-head__actions"><span className="muted">{state.actualizado ? `Actualizado ${new Date(state.actualizado).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Sincronizando…'}</span><button className="btn-secondary" onClick={() => setReload((n) => n + 1)} disabled={state.cargando}><Icono name="refresh" size={16} /> Actualizar</button></div></header>
    {state.error && <div className="operation-error" role="alert"><Icono name="alertCircle" size={18} /><div><strong>No se pudo actualizar el inicio</strong><p>{state.error}</p></div></div>}
    {state.cargando && !state.salud ? <section className="card operation-loading"><Cargando etiqueta="Cargando estado actual…" /></section> : <>
      <section className={`home-health home-health--${healthTone}`}><div><span className="eyebrow">Estado actual</span><h2>{healthText}</h2><p>{semana ? `${weekLabel(semana)} · ${weekStateLabel(semana)}` : 'No hay una semana activa.'}</p></div><div className="home-health__actions"><Link className="btn-primary" to="/operacion">Abrir operación</Link>{semana && <Link className="btn-secondary" to={`/finanzas?semana=${semana.id}&tab=cierre`}>Ver cierre</Link>}</div></section>
      <section className="home-metrics"><article><span>Ventas de hoy</span><strong>{mxn(ventasHoy?.total_ventas)}</strong><small>{ventasHoy ? 'Corte registrado' : 'Pendiente de corte'}</small></article><article><span>Ventas de la semana</span><strong>{mxn(resumen?.ventas_operativas ?? resumen?.ventas.total)}</strong><small>{resumen?.ventas_operativas != null ? 'Epos' : 'Captura provisional'}</small></article><article><span>Resultado operativo</span><strong className={resumen?.resultado_operativo != null && resumen.resultado_operativo < 0 ? 'metric-danger' : ''}>{mxn(resumen?.resultado_operativo)}</strong><small>{resumen?.resultado_operativo_estado ?? 'Al cierre'}</small></article><article><span>Brecha físico vs FIFO</span><strong className={resumen?.inventario.diferencia_fifo_vs_fisico != null && Math.abs(resumen.inventario.diferencia_fifo_vs_fisico) > 1 ? 'metric-danger' : ''}>{mxn(resumen?.inventario.diferencia_fifo_vs_fisico)}</strong><small>{resumen?.inventario.estado === 'cerrado' ? 'Conciliada' : 'Pendiente de cierre'}</small></article></section>
      <div className="home-grid"><section className="card home-actions"><div className="section-heading"><div><span className="eyebrow">Prioridades</span><h2>Lo que requiere atención</h2><p className="muted">Acciones conectadas al cierre y al dinero.</p></div><Link className="inline-link" to="/decisiones">Ver todas →</Link></div><div className="action-list">{actions.map((action) => <Link className={`action-row action-row--${action.tone}`} to={action.href} key={action.id}><span className="action-icon"><Icono name={action.tone === 'danger' ? 'alertCircle' : action.tone === 'warning' ? 'alertTriangle' : action.tone === 'info' ? 'sparkles' : 'checkCircle'} size={17} /></span><span className="action-copy"><strong>{action.title}</strong><small>{action.description}</small></span><span className="action-link">{action.label} <Icono name="chevron" size={15} /></span></Link>)}</div></section><section className="card home-flow"><div className="section-heading"><div><span className="eyebrow">Ritmo de la semana</span><h2>Operación conectada</h2></div></div><div className="flow-list"><div><span className="flow-number">1</span><span><strong>Ventas</strong><small>{resumen?.ventas_epos_pendientes ?? 0} pendientes de costeo</small></span></div><div><span className="flow-number">2</span><span><strong>Inventario</strong><small>{resumen?.inventario.estado === 'cerrado' ? 'Confirmado' : 'Esperando cierre físico'}</small></span></div><div><span className="flow-number">3</span><span><strong>Cortes</strong><small>{cortes} confirmados esta semana</small></span></div><div><span className="flow-number">4</span><span><strong>Resultado</strong><small>{resumen?.resultado_independiente ? 'Trazable' : 'Provisional'}</small></span></div></div><Link className="inline-link" to="/reportes">Abrir reportes →</Link></section></div>
      <section className="card home-quick"><div className="section-heading"><div><span className="eyebrow">Accesos rápidos</span><h2>Registrar sin perder contexto</h2></div></div><div className="home-quick__grid"><Link to="/compras" className="quick-action"><span><Icono name="package" size={19} /></span><strong>Compra o gasto</strong><small>Ticket, pago y lote</small></Link><Link to="/inventario?tipo=cierre" className="quick-action"><span><Icono name="checks" size={19} /></span><strong>Conteo físico</strong><small>Apertura o cierre</small></Link><Link to="/tareas" className="quick-action"><span><Icono name="checkCircle" size={19} /></span><strong>Checklist</strong><small>Tareas del día</small></Link>{admin && <Link to="/costos-menu" className="quick-action"><span><Icono name="trending" size={19} /></span><strong>Menú y margen</strong><small>Precio, receta y FIFO</small></Link>}</div></section>
    </>}
  </div>;
}
