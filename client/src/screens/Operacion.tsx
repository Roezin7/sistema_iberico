import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { Cargando } from '../ui/Cargando';
import { epos, finanzas, mxn, type ConciliacionDiaria, type DiaFila, type Resumen, type SaludOperativa, type Semana } from './finanzas/api';
import { todayMexico, weekLabel, weekStateLabel } from '../operating';

interface InventarioActual { valor_total: number; valor_fifo_actual_total: number; productos: ProductoInventario[]; sin_costo: { product_id: number; nombre: string }[] }
interface ProductoInventario { product_id: number; nombre: string; total_operativo: number; minimo_operativo: number; faltante_operativo?: number; unidad_operativa: string; fuente_valoracion: string; }
interface ListaCompras { total: number; grupos: { store: string; subtotal: number; items: { product_id: number; nombre: string; faltante: number; unidad_operativa?: string; valor_faltante: number }[] }[] }
interface TareasDia { fecha: string; checklists?: { id: number; nombre: string; tipo: string; completados: number; total: number }[]; items?: { id: number; texto: string; completado: boolean }[] }

type ActionTone = 'danger' | 'warning' | 'info' | 'success';
interface ActionItem { id: string; title: string; description: string; href: string; tone: ActionTone; label: string }

const toneIcon: Record<ActionTone, Parameters<typeof Icono>[0]['name']> = {
  danger: 'alertCircle', warning: 'alertTriangle', info: 'sparkles', success: 'checkCircle',
};

function todayLabel() {
  return new Date(`${todayMexico()}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function actionFromHealth(salud: SaludOperativa | null, semana: Semana | null, resumen: Resumen | null, conciliaciones: ConciliacionDiaria[]) {
  const items: ActionItem[] = [];
  (salud?.bloqueadores ?? []).slice(0, 3).forEach((description, i) => items.push({ id: `block-${i}`, title: 'Resolver bloqueador', description, href: '/decisiones', tone: 'danger', label: 'Revisar' }));
  if (resumen?.ventas_epos_pendientes) items.push({ id: 'epos-pending', title: 'Costear ventas pendientes', description: `${resumen.ventas_epos_pendientes} ventas esperan receta, mapeo o lote FIFO.`, href: '/compras?tab=epos', tone: 'warning', label: 'Resolver' });
  if (semana && !semana.cerrada_at && resumen?.inventario.estado !== 'cerrado') items.push({ id: 'inventory-close', title: 'Confirmar inventario', description: 'El cierre físico se compara contra apertura, compras y consumo teórico.', href: `/inventario?tipo=cierre&semana=${semana.id}`, tone: 'warning', label: 'Abrir conteo' });
  if (semana && !semana.cerrada_at && conciliaciones.filter((c) => c.fecha >= semana.fecha_inicio && c.fecha <= semana.fecha_fin).length === 0) items.push({ id: 'daily-cut', title: 'Confirmar corte diario', description: 'Importa las ventas de Epos y confirma los métodos de pago del día.', href: `/finanzas?semana=${semana.id}&tab=dia`, tone: 'info', label: 'Abrir corte' });
  (salud?.advertencias ?? []).slice(0, 3).forEach((description, i) => items.push({ id: `warn-${i}`, title: 'Revisar advertencia', description, href: '/decisiones', tone: 'warning', label: 'Ver' }));
  if (!items.length) items.push({ id: 'ok', title: 'Operación en orden', description: 'No hay bloqueadores críticos. Mantén el registro diario y confirma el cierre cuando corresponda.', href: '/tareas', tone: 'success', label: 'Ver checklist' });
  return items.slice(0, 6);
}

export default function Operacion() {
  const { usuario } = useAuth();
  const admin = usuario?.rol === 'admin';
  const [semana, setSemana] = useState<Semana | null>(null);
  const [salud, setSalud] = useState<SaludOperativa | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [dias, setDias] = useState<DiaFila[]>([]);
  const [conciliaciones, setConciliaciones] = useState<ConciliacionDiaria[]>([]);
  const [inventario, setInventario] = useState<InventarioActual | null>(null);
  const [compras, setCompras] = useState<ListaCompras | null>(null);
  const [tareas, setTareas] = useState<TareasDia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [actualizado, setActualizado] = useState<Date | null>(null);

  async function cargar() {
    setCargando(true); setError('');
    const inventarioPromise = api<InventarioActual>('/inventario/current?vista=fisica');
    const comprasPromise = api<ListaCompras>('/inventario/shopping-list');
    const tareasPromise = api<TareasDia>(`/tareas/dia?fecha=${todayMexico()}`);
    const corePromise = admin
      ? Promise.all([finanzas.semanaActual(), finanzas.saludOperativa()])
      : Promise.resolve([null, null] as const);
    try {
      const [[semanaActual, saludActual], tareasDia] = await Promise.all([corePromise, tareasPromise]);
      setSemana(semanaActual); setSalud(saludActual); setTareas(tareasDia); setCargando(false); setActualizado(new Date());

      // Las consultas de mayor volumen quedan fuera del primer render útil.
      void inventarioPromise.then(setInventario).catch((e) => setError(e instanceof Error ? `Inventario: ${e.message}` : 'No se pudo leer el inventario.'));
      void comprasPromise.then(setCompras).catch((e) => setError(e instanceof Error ? `Compras: ${e.message}` : 'No se pudo leer la lista de compras.'));
      if (admin && semanaActual) {
        void Promise.all([finanzas.resumen(semanaActual.id), finanzas.dias(semanaActual.id), epos.conciliaciones(semanaActual.id).catch(() => [])]).then(([weekSummary, daily, cuts]) => {
          setResumen(weekSummary); setDias(daily.dias); setConciliaciones(cuts);
        }).catch((e) => setError(e instanceof Error ? `Semana: ${e.message}` : 'No se pudo leer el resumen de la semana.'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la operación.'); setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, [admin]);

  const actions = useMemo(() => actionFromHealth(salud, semana, resumen, conciliaciones), [salud, semana, resumen, conciliaciones]);
  const faltantes = useMemo(() => (compras?.grupos ?? []).flatMap((g) => g.items).sort((a, b) => b.valor_faltante - a.valor_faltante), [compras]);
  const ventasHoy = dias.find((d) => d.fecha === todayMexico());
  const tareasCompletadas = tareas?.items?.filter((i) => i.completado).length ?? 0;
  const tareasTotal = tareas?.items?.length ?? 0;
  const estado = salud?.estado === 'requiere_atencion' ? 'danger' : salud?.estado === 'operable_con_alertas' ? 'warning' : 'success';
  const estadoLabel = estado === 'danger' ? 'Requiere atención' : estado === 'warning' ? 'Operable con alertas' : 'Operación lista';

  if (!usuario) return null;
  return <div className="page operation-page">
    <header className="page-head operation-head">
      <div><span className="eyebrow">Operación diaria</span><h1>{todayLabel()}</h1><p className="page-sub">Un solo lugar para registrar, revisar y cerrar el día.</p></div>
      <div className="page-head__actions"><span className="sync-label"><span className="sync-dot sync-dot--ok" /> Datos actualizados {actualizado ? actualizado.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}</span><button className="btn-secondary" onClick={() => void cargar()} disabled={cargando}><Icono name="refresh" size={16} className={cargando ? 'cargando__spin' : undefined} /> Actualizar</button></div>
    </header>
    {error && <div className="operation-error" role="alert"><Icono name="alertCircle" size={18} /><div><strong>No se pudo completar la lectura</strong><p>{error}</p></div><button className="btn-secondary" onClick={() => void cargar()}>Reintentar</button></div>}
    {cargando && !inventario && !resumen ? <section className="card operation-loading"><Cargando etiqueta="Preparando operación…" /></section> : <>
      <section className={`operation-status operation-status--${estado}`}><div><span className="eyebrow">Estado del sistema</span><h2>{estadoLabel}</h2><p>{semana ? `${weekLabel(semana)} · ${weekStateLabel(semana)}` : 'La operación diaria sigue disponible para registrar actividad.'}</p></div><div className="operation-status__actions"><Link className="btn-primary" to={admin && semana ? `/finanzas?semana=${semana.id}&tab=dia` : '/tareas'}>{admin ? 'Abrir jornada' : 'Abrir checklist'}</Link>{admin && semana && <Link className="btn-secondary" to={`/finanzas?semana=${semana.id}&tab=cierre`}>Preparar cierre</Link>}</div></section>

      <section className="operation-metrics" aria-label="Resumen operativo">
        <article><span>Ventas de hoy</span><strong>{mxn(ventasHoy?.total_ventas ?? null)}</strong><small>{ventasHoy ? 'Registradas' : 'Aún sin corte'}</small></article>
        <article><span>Inventario físico</span><strong>{mxn(inventario?.valor_total)}</strong><small>{inventario ? `${inventario.productos.length} productos` : '—'}</small></article>
        <article><span>Faltantes</span><strong className={faltantes.length ? 'metric-danger' : ''}>{faltantes.length}</strong><small>{faltantes.length ? `${mxn(compras?.total)} estimado` : 'Todo en rango'}</small></article>
        <article><span>Checklist</span><strong>{tareasTotal ? `${tareasCompletadas}/${tareasTotal}` : '—'}</strong><small>{tareasTotal ? 'Completado hoy' : 'Sin tareas asignadas'}</small></article>
      </section>

      <div className="operation-grid">
        <section className="card operation-actions"><div className="section-heading"><div><span className="eyebrow">Siguiente paso</span><h2>Acciones prioritarias</h2><p className="muted">El sistema ordena lo que puede bloquear el cierre.</p></div></div><div className="action-list">{actions.map((item) => <Link className={`action-row action-row--${item.tone}`} to={item.href} key={item.id}><span className="action-icon"><Icono name={toneIcon[item.tone]} size={17} /></span><span className="action-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="action-link">{item.label} <Icono name="chevron" size={15} /></span></Link>)}</div></section>

        <section className="card operation-quick"><div className="section-heading"><div><span className="eyebrow">Captura rápida</span><h2>Registrar sin navegar</h2></div></div><div className="quick-actions"><Link to="/compras" className="quick-action"><span><Icono name="package" size={19} /></span><strong>Compra o gasto</strong><small>Subir ticket y revisar</small></Link><Link to="/inventario?tipo=cierre" className="quick-action"><span><Icono name="checks" size={19} /></span><strong>Conteo físico</strong><small>Apertura, cierre o ajuste</small></Link><Link to="/tareas" className="quick-action"><span><Icono name="checkCircle" size={19} /></span><strong>Checklist</strong><small>Ver tareas del día</small></Link><Link to={admin && semana ? `/finanzas?semana=${semana.id}&tab=dia` : '/'} className="quick-action"><span><Icono name="wallet" size={19} /></span><strong>{admin ? 'Corte Epos' : 'Ver inicio'}</strong><small>{admin ? 'Ventas y métodos de pago' : 'Estado del negocio'}</small></Link></div></section>
      </div>

      <div className="operation-grid operation-grid--secondary">
        <section className="card"><div className="section-heading"><div><span className="eyebrow">Abasto</span><h2>Lo que falta comprar</h2></div><Link className="inline-link" to="/inventario">Ver inventario →</Link></div>{faltantes.length ? <div className="operation-stock-list">{faltantes.slice(0, 7).map((item) => <div key={item.product_id}><span><strong>{item.nombre}</strong><small>Faltan {item.faltante.toLocaleString('es-MX', { maximumFractionDigits: 2 })} {item.unidad_operativa ?? 'unidades'}</small></span><strong>{mxn(item.valor_faltante)}</strong></div>)}</div> : <div className="empty-inline"><Icono name="checkCircle" size={18} /><span>Inventario dentro de mínimos.</span></div>}</section>
        <section className="card"><div className="section-heading"><div><span className="eyebrow">Trazabilidad</span><h2>Qué alimenta los números</h2></div></div><div className="trace-list"><div><span className="trace-dot trace-dot--ok" /><span><strong>Ventas</strong><small>{admin ? `${resumen?.ventas_epos_pendientes ?? 0} pendientes de costeo` : 'Fuente Epos y corte diario'}</small></span></div><div><span className="trace-dot trace-dot--ok" /><span><strong>Inventario</strong><small>{inventario?.sin_costo?.length ? `${inventario.sin_costo.length} productos sin costo` : 'Físico y FIFO disponibles'}</small></span></div><div><span className={`trace-dot trace-dot--${semana?.estado === 'cerrada' ? 'ok' : 'warn'}`} /><span><strong>Semana</strong><small>{semana ? weekStateLabel(semana) : 'Sin semana activa'}</small></span></div></div></section>
      </div>
    </>}
  </div>;
}
