import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { Cargando } from '../ui/Cargando';
import { epos, finanzas, mxn, type ConciliacionDiaria, type DiaFila, type EstadoResultadosData, type PatrimonioSnapshot, type Resumen, type SaludOperativa, type Semana, type TableroSnapshot } from './finanzas/api';
import { weekLabel, weekStateLabel } from '../operating';

interface DashboardState {
  semana: Semana | null;
  dias: DiaFila[];
  conciliaciones: ConciliacionDiaria[];
  resumen: Resumen | null;
  salud: SaludOperativa | null;
  tablero: TableroSnapshot | null;
  patrimonio: PatrimonioSnapshot[];
  resultados: EstadoResultadosData | null;
  cargando: boolean;
  error: string;
  actualizado: string | null;
}

const initialState: DashboardState = {
  semana: null, dias: [], conciliaciones: [], resumen: null, salud: null, tablero: null, patrimonio: [], resultados: null,
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

function mesCorto(mes: string) {
  return new Date(`${mes}-01T12:00:00Z`).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '');
}

function porcentajeBarra(valor: number, maximo: number) {
  if (!maximo || valor <= 0) return 0;
  return Math.max(5, Math.min(100, (valor / maximo) * 100));
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
    void Promise.all([finanzas.semanaActual(), finanzas.saludOperativa(), finanzas.tableroDecisiones(8), finanzas.patrimonioTendencia(), finanzas.estadoResultados(12)])
      .then(async ([semana, salud, tablero, patrimonioData, resultados]) => {
        if (!semana) return { semana: null, dias: [], conciliaciones: [], resumen: null, salud, tablero, patrimonio: patrimonioData.serie, resultados };
        const [dias, resumen, conciliaciones] = await Promise.all([
          finanzas.dias(semana.id),
          finanzas.resumen(semana.id),
          epos.conciliaciones(semana.id).catch(() => []),
        ]);
        return { semana, dias: dias.dias, conciliaciones, resumen, salud, tablero, patrimonio: patrimonioData.serie, resultados };
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

  const { semana, dias, conciliaciones, resumen, salud, tablero, patrimonio, resultados } = estado;
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
  const resultadosConMovimiento = resultados?.meses.filter((fila) => !fila.sin_movimientos) ?? [];
  const maxVentas = Math.max(...resultadosConMovimiento.map((fila) => fila.ventas_netas), 0);
  const ultimoPatrimonio = patrimonio[patrimonio.length - 1] ?? null;
  const patrimonioAnterior = patrimonio.length > 1 ? patrimonio[patrimonio.length - 2] : null;
  const variacionPatrimonio = ultimoPatrimonio && patrimonioAnterior ? ultimoPatrimonio.patrimonio_neto - patrimonioAnterior.patrimonio_neto : null;

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
        <article className="dashboard-kpi dashboard-kpi--equity"><span>Patrimonio neto</span><strong>{mxn(resumen?.patrimonio_neto ?? ultimoPatrimonio?.patrimonio_neto)}</strong><small>{resumen?.patrimonio_neto != null ? 'Semana actual' : 'Último cierre'}</small></article>
      </section>

      <section className="dashboard-longitudinal" aria-label="Tendencias de ventas y patrimonio">
        <section className="card dashboard-performance"><div className="section-heading"><div><span className="eyebrow">Tendencia</span><h2>Ventas y rentabilidad</h2><p className="muted">Por mes · datos registrados.</p></div><Link className="inline-link" to="/costos-menu">Ver detalle →</Link></div>
          {resultadosConMovimiento.length === 0 ? <p className="muted">Sin historial suficiente.</p> : <div className="dashboard-month-list">{resultadosConMovimiento.slice(-6).map((fila) => <div className="dashboard-month" key={fila.mes}><div className="dashboard-month__label"><strong>{mesCorto(fila.mes)}</strong><span>{mxn(fila.ventas_netas)}</span></div><div className="dashboard-month__bar"><span style={{ width: `${porcentajeBarra(fila.ventas_netas, maxVentas)}%` }} /></div><div className="dashboard-month__meta"><span>Utilidad {mxn(fila.utilidad_operativa)}</span><span>Margen {(fila.margen_operativo * 100).toFixed(1)}%</span></div></div>)}</div>}
          {resultados && <div className="dashboard-performance__total"><span>Acumulado {resultados.total.meses} meses</span><strong>{mxn(resultados.total.ventas_netas)} ventas · {mxn(resultados.total.utilidad_operativa)} utilidad</strong></div>}
        </section>
        <section className="card dashboard-equity"><div className="section-heading"><div><span className="eyebrow">Patrimonio</span><h2>Valor neto en el tiempo</h2><p className="muted">Cierres semanales.</p></div><Link className="inline-link" to="/patrimonio">Ver patrimonio →</Link></div>
          {ultimoPatrimonio ? <><div className="dashboard-equity__headline"><strong>{mxn(ultimoPatrimonio.patrimonio_neto)}</strong><span className={variacionPatrimonio != null && variacionPatrimonio < 0 ? 'text-danger' : 'text-success'}>{variacionPatrimonio == null ? 'Primer cierre' : `${variacionPatrimonio >= 0 ? '+' : ''}${mxn(variacionPatrimonio)} vs. anterior`}</span></div><div className="dashboard-equity__parts"><div><span>Banco</span><strong>{mxn(ultimoPatrimonio.total_banco)}</strong></div><div><span>Efectivo</span><strong>{mxn(ultimoPatrimonio.total_efectivo)}</strong></div><div><span>Inventario físico</span><strong>{mxn(ultimoPatrimonio.total_inventario)}</strong></div><div><span>Pasivos</span><strong className="text-danger">−{mxn(ultimoPatrimonio.total_pasivos)}</strong></div></div><p className="dashboard-formula">Neto = banco + efectivo + inventario − pasivos</p><div className="dashboard-equity__history">{patrimonio.slice(-5).reverse().map((fila) => <div key={fila.id}><span>{fila.fecha}</span><strong>{mxn(fila.patrimonio_neto)}</strong></div>)}</div></> : <p className="muted">Sin cierres patrimoniales.</p>}
        </section>
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
