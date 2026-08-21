import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  finanzas, epos, mxn, TIPOS, type Referencias, type Semana, type Resumen, type FilaCuadre,
  type Movimiento, type TipoMov, type DiaFila, type ConciliacionDiaria,
} from './api';
import { Icono } from '../../icons';
import { descargarCSV } from '../../csv';
import { useConfirm } from '../../ui/ConfirmProvider';
import { useToast } from '../../ui/ToastProvider';
import { Cargando } from '../../ui/Cargando';

function sumarDias(fechaIso: string, n: number): string {
  const d = new Date(fechaIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function esDiaOperativo(fecha: string) {
  const weekday = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 5 || weekday === 6;
}

export default function Finanzas() {
  const [ref, setRef] = useState<Referencias | null>(null);
  const [saldosFijados, setSaldosFijados] = useState<boolean | null>(null);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semanaId, setSemanaId] = useState<number | null>(null);
  const [fechaNueva, setFechaNueva] = useState('');
  const { error } = useToast();

  async function recargar() {
    const [r, si, sems] = await Promise.all([
      finanzas.referencias(), finanzas.getSaldosIniciales(), finanzas.semanas(),
    ]);
    setRef(r);
    setSaldosFijados(si.length > 0);
    setSemanas(sems);
    setSemanaId((prev) => prev ?? sems.find((s) => s.estado === 'abierta')?.id ?? sems[0]?.id ?? null);
  }
  useEffect(() => { void recargar(); }, []);

  // Siguiente semana en la cadena: el día después del fecha_fin de la última semana
  // registrada (abierta o cerrada). Editable para poder abrir una semana anterior que
  // se haya quedado sin abrir, y así no perder ni saltar ninguna.
  const ultima = semanas[0]; // semanas viene ordenado por fecha_inicio desc
  const siguiente = ultima ? sumarDias(ultima.fecha_fin, 1) : undefined;
  useEffect(() => { if (siguiente) setFechaNueva(siguiente); }, [siguiente]);

  if (!ref || saldosFijados == null) return <Marco><Cargando /></Marco>;
  if (!saldosFijados) return <Marco><SetupSaldos ref_={ref} onListo={recargar} /></Marco>;

  const semana = semanas.find((s) => s.id === semanaId) ?? null;

  return (
    <Marco>
      <div className="semana-bar">
        <select value={semanaId ?? ''} onChange={(e) => setSemanaId(Number(e.target.value))}>
          {semanas.map((s) => (
            <option key={s.id} value={s.id}>{s.etiqueta} {s.estado === 'cerrada' ? '🔒' : '·'}</option>
          ))}
        </select>
        <input type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} title="Lunes de la semana a abrir" />
        <button className="pill" onClick={async () => {
          try { const s = await finanzas.crearSemana(fechaNueva || undefined); setSemanaId(s.id); recargar(); }
          catch (e) { error(e instanceof Error ? e.message : 'No se pudo crear la semana'); }
        }}>+ Semana</button>
      </div>
      {!semana ? (
        <p className="muted">No hay semanas. Crea una para empezar.</p>
      ) : (
        <SemanaPanel ref_={ref} semana={semana} onCambio={recargar} />
      )}
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="wallet" size={24} className="ttl-icon" />
        <h1>Cierre y caja</h1>
        </div>
      </header>
      <div className="tab-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SetupSaldos({ ref_, onListo }: { ref_: Referencias; onListo: () => void }) {
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  return (
    <>
      <div className="aviso">Fija el saldo inicial de cada ubicación. ⚠️ Se establece <b>una sola vez</b> y no es editable.</div>
      {ref_.ubicaciones.map((u) => (
        <div key={u.id} className="conteo-row">
          <div className="conteo-info"><strong>{u.nombre}</strong><small className="muted">{u.tipo}</small></div>
          <input className="conteo-input" type="number" inputMode="decimal" placeholder="0"
            value={montos[u.id] ?? ''} onChange={(e) => setMontos({ ...montos, [u.id]: e.target.value })} />
        </div>
      ))}
      {error && <p className="error-msg">{error}</p>}
      <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={async () => {
        try {
          await finanzas.fijarSaldosIniciales(ref_.ubicaciones.map((u) => ({ ubicacion_id: u.id, monto: Number(montos[u.id] ?? 0) })));
          onListo();
        } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
      }}>Fijar saldos iniciales</button>
    </>
  );
}

// ---------------------------------------------------------------------------
function SemanaPanel({ ref_, semana, onCambio }: { ref_: Referencias; semana: Semana; onCambio: () => void }) {
  const [tab, setTab] = useState<'dia' | 'resumen' | 'movs' | 'cuadre'>('dia');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [cuadre, setCuadre] = useState<FilaCuadre[]>([]);
  const [dias, setDias] = useState<DiaFila[]>([]);
  const [conciliaciones, setConciliaciones] = useState<ConciliacionDiaria[]>([]);
  const confirmar = useConfirm();
  const { error } = useToast();

  async function cargar() {
    const [r, m, c, d, conciliacionesData] = await Promise.all([
      finanzas.resumen(semana.id), finanzas.movimientos(semana.id), finanzas.cuadre(semana.id), finanzas.dias(semana.id),
      epos.conciliaciones(semana.id).catch(() => []),
    ]);
    setResumen(r); setMovs(m); setCuadre(c.ubicaciones); setDias(d.dias); setConciliaciones(conciliacionesData);
  }
  useEffect(() => { void cargar(); }, [semana.id]);

  const abierta = semana.estado === 'abierta';

  return (
    <>
      <div className="kv" style={{ borderBottom: 'none', marginTop: 0, paddingTop: 0 }}>
        <span className="muted">{semana.fecha_inicio} → {semana.fecha_fin}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span className={abierta ? 'chip chip--info' : 'chip chip--ok'}>{abierta ? 'Abierta' : 'Cerrada'}</span>
          {!abierta && (
            <button className="link-btn" onClick={async () => {
              const ok = await confirmar({
                message: '¿Reabrir la semana para editarla? Se quitarán la comisión de terminal y el snapshot de patrimonio de esta semana; se regeneran al volver a cerrar.',
                tone: 'danger', confirmText: 'Reabrir',
              });
              if (!ok) return;
              try { await finanzas.reabrir(semana.id); onCambio(); cargar(); }
              catch (e) { error(e instanceof Error ? e.message : 'No se pudo reabrir'); }
            }}>Reabrir</button>
          )}
        </span>
      </div>
      <nav className="tabs">
        <button className={tab === 'dia' ? 'tab tab--on' : 'tab'} onClick={() => setTab('dia')}>Cortes diarios</button>
        <button className={tab === 'resumen' ? 'tab tab--on' : 'tab'} onClick={() => setTab('resumen')}>Resumen</button>
        <button className={tab === 'movs' ? 'tab tab--on' : 'tab'} onClick={() => setTab('movs')}>Movimientos</button>
        <button className={tab === 'cuadre' ? 'tab tab--on' : 'tab'} onClick={() => setTab('cuadre')}>Cuadre</button>
      </nav>

      {tab === 'dia' && <DiaView semana={semana} dias={dias} conciliaciones={conciliaciones} onChange={cargar} />}
      {tab === 'resumen' && resumen && <ResumenView r={resumen} />}
      {tab === 'movs' && (
        <MovimientosView ref_={ref_} semana={semana} movs={movs} onChange={cargar} />
      )}
      {tab === 'cuadre' && (
        <CuadreView ref_={ref_} semana={semana} filas={cuadre} onChange={cargar} />
      )}

      {abierta && (tab === 'resumen' || tab === 'cuadre') && (
        <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={async () => {
          const ok = await confirmar({
            message: '¿Cerrar la semana? Se generará la comisión de terminal y se congelarán los saldos.',
            confirmText: 'Cerrar semana',
          });
          if (!ok) return;
          await finanzas.cerrar(semana.id); onCambio(); cargar();
        }}>Cerrar semana</button>
      )}
    </>
  );
}

function DiaView({ semana, dias, conciliaciones, onChange }: { semana: Semana; dias: DiaFila[]; conciliaciones: ConciliacionDiaria[]; onChange: () => void }) {
  const abierta = semana.estado === 'abierta';
  const operativos = dias.filter((d) => esDiaOperativo(d.fecha));
  const maxVenta = Math.max(1, ...operativos.map((d) => d.total_ventas));
  const totalSemana = operativos.reduce((a, d) => a + d.total_ventas, 0);
  const promedio = operativos.length ? totalSemana / operativos.length : 0;

  return (
    <>
      <div className="resumen-card">
        <span className="muted">Ventas de la semana</span>
        <strong className="big-number">{mxn(totalSemana)}</strong>
      </div>

      {/* Mini-gráfica de barras por día — misma paleta de datos que Patrimonio:
          vino resalta el día tope, olivo los que superan el promedio de la semana. */}
      <div className="dia-chart chart-frame">
        {operativos.map((d) => {
          const claseBarra = d.total_ventas >= maxVenta ? 'dia-bar--max' : d.total_ventas > promedio ? 'dia-bar--alto' : '';
          return (
            <div key={d.fecha} className="dia-bar-wrap" title={`${d.dia} ${mxn(d.total_ventas)}`}>
              <div className={`dia-bar ${claseBarra}`} style={{ height: `${(d.total_ventas / maxVenta) * 100}%` }} />
              <small className="muted">{d.dia}</small>
            </div>
          );
        })}
      </div>

      {operativos.length === 0 && <div className="empty-state"><strong>No hay días operativos en esta semana.</strong><p>Ibérico registra ventas regulares de viernes a domingo.</p></div>}
      {dias.map((d) => (
        <DiaCard key={d.fecha} semana={semana} dia={d} abierta={abierta} operativo={esDiaOperativo(d.fecha)} conciliacion={conciliaciones.find((c) => c.fecha === d.fecha)} onSaved={onChange} />
      ))}
    </>
  );
}

function DiaCard({ semana, dia, abierta, operativo, conciliacion, onSaved }: { semana: Semana; dia: DiaFila; abierta: boolean; operativo: boolean; conciliacion?: ConciliacionDiaria; onSaved: () => void }) {
  const [efectivo, setEfectivo] = useState(String(dia.venta_efectivo || ''));
  const [tarjeta, setTarjeta] = useState(String(dia.venta_tarjeta || ''));
  const [propina, setPropina] = useState(String(dia.propina_tarjeta || ''));
  const [gasto, setGasto] = useState(String(dia.gasto_efectivo || ''));
  const [sueldos, setSueldos] = useState(String(dia.sueldos || ''));
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);
  const [consultandoEpos, setConsultandoEpos] = useState(false);
  const [eposNota, setEposNota] = useState('');
  const [eposCorte, setEposCorte] = useState<Awaited<ReturnType<typeof epos.syncDaily>> | null>(null);
  const [cuentasAbiertas, setCuentasAbiertas] = useState(String(conciliacion?.cuentas_abiertas ?? 0));
  const { error } = useToast();

  useEffect(() => {
    setCuentasAbiertas(String(conciliacion?.cuentas_abiertas ?? 0));
  }, [conciliacion?.cuentas_abiertas]);

  // Resincroniza si cambian los datos del servidor.
  useEffect(() => {
    setEfectivo(String(dia.venta_efectivo || ''));
    setTarjeta(String(dia.venta_tarjeta || ''));
    setPropina(String(dia.propina_tarjeta || ''));
    setGasto(String(dia.gasto_efectivo || ''));
    setSueldos(String(dia.sueldos || ''));
  }, [dia.venta_efectivo, dia.venta_tarjeta, dia.propina_tarjeta, dia.gasto_efectivo, dia.sueldos]);

  const n = (s: string) => Number(s) || 0;
  const ventas = n(efectivo) + n(tarjeta) + n(propina);
  const egresos = n(gasto) + n(sueldos);

  async function guardar() {
    setGuardando(true); setOk(false);
    try {
      await finanzas.guardarDia(semana.id, {
        fecha: dia.fecha, venta_efectivo: n(efectivo), venta_tarjeta: n(tarjeta),
        propina_tarjeta: n(propina), gasto_efectivo: n(gasto), sueldos: n(sueldos),
      });
      setOk(true); onSaved();
      setTimeout(() => setOk(false), 1500);
    } finally { setGuardando(false); }
  }

  async function consultarEpos() {
    setConsultandoEpos(true); setEposNota('');
    try {
    const corte = await epos.syncDaily(dia.fecha);
      setEposCorte(corte);
      const metodo = (nombre: string) => corte.bookkeeping.metodos_pago.find((item) => item.metodo.toLowerCase() === nombre.toLowerCase())?.total ?? 0;
      const otros = corte.bookkeeping.metodos_pago
        .filter((item) => !['cash', 'card'].includes(item.metodo.toLowerCase()))
        .reduce((total, item) => total + item.total, 0);
      setEfectivo(String(metodo('Cash')));
      setTarjeta(String(metodo('Card')));
      setEposNota(otros ? `Importado: ${mxn(corte.bookkeeping.ventas)} · otros métodos ${mxn(otros)} · revisa y confirma` : `Importado: ${mxn(corte.bookkeeping.ventas)} · revisa y confirma`);
    } catch (e) {
      error(e instanceof Error ? e.message : 'No se pudo consultar Epos');
    } finally { setConsultandoEpos(false); }
  }

  async function confirmarCorte() {
    if (!eposCorte) return;
    try {
      // La confirmación es el punto único que convierte la revisión del corte
      // en el registro diario financiero. El botón manual sigue disponible
      // cuando no se consultó Epos.
      await finanzas.guardarDia(semana.id, {
        fecha: dia.fecha, venta_efectivo: n(efectivo), venta_tarjeta: n(tarjeta),
        propina_tarjeta: n(propina), gasto_efectivo: n(gasto), sueldos: n(sueldos),
      });
      const otrosEpos = eposCorte.bookkeeping.metodos_pago
        .filter((m) => !['cash', 'card'].includes(m.metodo.toLowerCase()))
        .reduce((a, m) => a + m.total, 0);
      await epos.confirmarConciliacion({
        semana_id: semana.id,
        fecha: dia.fecha,
        epos: {
          ventas: eposCorte.bookkeeping.ventas,
          efectivo: eposCorte.bookkeeping.metodos_pago.find((m) => m.metodo.toLowerCase() === 'cash')?.total ?? 0,
          tarjeta: eposCorte.bookkeeping.metodos_pago.find((m) => m.metodo.toLowerCase() === 'card')?.total ?? 0,
          otros: eposCorte.bookkeeping.metodos_pago.filter((m) => !['cash', 'card'].includes(m.metodo.toLowerCase())).reduce((a, m) => a + m.total, 0),
        },
        confirmado: { ventas: n(efectivo) + n(tarjeta) + n(propina) + otrosEpos, efectivo: n(efectivo), tarjeta: n(tarjeta), otros: otrosEpos },
        cuentas_abiertas: n(cuentasAbiertas),
        excepciones: [],
        notas: eposNota || undefined,
      });
      setEposNota('Corte confirmado y guardado como evidencia.');
      setEposCorte(null);
      onSaved();
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo confirmar el corte'); }
  }

  const campo = (emoji: string, label: string, val: string, set: (v: string) => void) => (
    <label>{emoji} {label}<input type="number" inputMode="decimal" value={val} disabled={!abierta} onChange={(e) => set(e.target.value)} placeholder="0" /></label>
  );

  return (
    <div className="dia-card">
      <div className="dia-card__head">
        <strong>{dia.dia} <span className="muted">{dia.fecha.slice(5)}</span></strong>
        <span className="muted">{operativo ? `ventas ${mxn(ventas)}` : 'captura administrativa'}{egresos ? ` · egresos ${mxn(egresos)}` : ''}</span>
      </div>
      {operativo && <>
        <div className="dia-section muted">Ventas <span className={conciliacion ? 'badge-ok' : 'badge-neutral'}>{conciliacion ? 'Corte confirmado' : 'Pendiente de corte'}</span></div>
        <div className="dia-inputs">
          {campo('💵', 'Efectivo', efectivo, setEfectivo)}
          {campo('💳', 'Tarjeta', tarjeta, setTarjeta)}
          {campo('🎁', 'Propina', propina, setPropina)}
        </div>
        {abierta && (
          <div style={{ marginTop: '0.6rem' }}>
            <button className="pill" onClick={consultarEpos} disabled={consultandoEpos}>
              {consultandoEpos ? 'Importando Epos…' : 'Importar y revisar Epos'}
            </button>
            {eposNota && <small className="muted" style={{ display: 'block', marginTop: '0.4rem' }}>{eposNota}</small>}
            {eposCorte && <>
              <label className="inline-field">Cuentas abiertas al cierre
                <input type="number" min="0" step="1" value={cuentasAbiertas} onChange={(e) => setCuentasAbiertas(e.target.value)} />
              </label>
              <button className="btn-primary" style={{ marginTop: '0.55rem' }} onClick={() => void confirmarCorte()}>Confirmar corte y guardar</button>
            </>}
          </div>
        )}
      </>}
      <div className="dia-section muted">Egresos del día</div>
      {(dia.gasto_itemizado > 0 || dia.compra_inventario > 0) && (
        <div className="info-box info-box--compact">
          <strong>Compras capturadas:</strong>{dia.compra_inventario ? ` FIFO ${mxn(dia.compra_inventario)}` : ''}{dia.compra_inventario && dia.gasto_itemizado ? ' ·' : ''}{dia.gasto_itemizado ? ` gastos ${mxn(dia.gasto_itemizado)}` : ''}
          <Link to={`/compras?fecha=${dia.fecha}`} className="inline-link">Ver compras del día</Link>
        </div>
      )}
      <div className="dia-inputs dia-inputs--2">
        {campo('🧾', 'Otros gastos no registrados', gasto, setGasto)}
        {campo('👷', 'Sueldos', sueldos, setSueldos)}
      </div>
      {abierta && (
        <div className="dia-actions">
          <Link className="btn-secondary" to={`/compras?fecha=${dia.fecha}`}>Agregar compra</Link>
          <button className="btn-primary dia-save" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar día'}
          </button>
        </div>
      )}
    </div>
  );
}

function ResumenView({ r }: { r: Resumen }) {
  const fila = (l: string, v: string, em?: boolean) => (
    <div className="kv"><span className="muted">{l}</span><span className={em ? 'big-number' : ''}>{v}</span></div>
  );
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi kpi--vino">
          <div className="kpi__label">Utilidad</div>
          <div className="kpi__value">{mxn(r.utilidad)}</div>
        </div>
        <div className="kpi kpi--ochre">
          <div className="kpi__label">Margen</div>
          <div className="kpi__value">{(r.margen * 100).toFixed(1)}%</div>
        </div>
        <div className="kpi kpi--olivo">
          <div className="kpi__label">Utilidad %</div>
          <div className="kpi__value">{(r.utilidad_pct * 100).toFixed(0)}%</div>
        </div>
        <div className="kpi kpi--azulejo">
          <div className="kpi__label">Ventas totales</div>
          <div className="kpi__value">{mxn(r.ventas.total)}</div>
        </div>
      </div>
      <div className="resumen-card">
        {fila('Ventas efectivo', mxn(r.ventas.efectivo))}
        {fila('Ventas tarjeta', mxn(r.ventas.tarjeta))}
        {fila('Propinas tarjeta', mxn(r.ventas.propinas))}
        {fila('Ventas totales', mxn(r.ventas.total))}
        {fila('Comisión terminal (1.99%)', mxn(r.comision_terminal_estimada))}
        {fila('Compras inventario', mxn(r.compras_inventario))}
      </div>
      <div className="resumen-card">
        <strong>Ciclo semanal de inventario</strong>
        {fila('Inventario de apertura', mxn(r.inventario.apertura_valor))}
        {fila('Compras de la semana', mxn(r.inventario.compras))}
        {fila('Inventario de cierre', mxn(r.inventario.cierre_valor))}
        {fila('Costo de ventas (apertura + compras − cierre)', mxn(r.inventario.costo_ventas))}
        <p className="muted" style={{ margin: '0.55rem 0 0', fontSize: '0.82rem' }}>
          {r.inventario.estado === 'pendiente_cierre'
            ? 'Pendiente: captura el inventario físico de cierre para abrir la siguiente semana con ese mismo saldo.'
            : 'El inventario de cierre queda congelado y será la apertura de la siguiente semana.'}
        </p>
      </div>
      <div className="resumen-card">
        <strong>Facturado (cuadre fiscal)</strong>
        {fila('Tarjeta facturable', mxn(r.facturado.tarjeta_facturable))}
        {fila('Gastos facturados', mxn(r.facturado.gastos_facturados))}
        {fila('(+/−)', mxn(r.facturado.balance))}
      </div>
      <div className="resumen-card">
        <strong>Capital por socio</strong>
        {r.capital_socios.map((c) => (
          <div key={c.socio_id} className="kv">
            <span className="muted">{c.nombre} <small>(transf {mxn(c.transferencias)} − retiros {mxn(c.retiros)})</small></span>
            <span>{mxn(c.capital)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function CuadreBanner({ filas }: { filas: FilaCuadre[] }) {
  if (filas.length === 0) return null;
  const desc = (n: number | null) => (n == null ? 0 : Math.round(n * 100) / 100);
  const pendientes = filas.filter((f) => f.saldo_real == null);
  const descuadrados = filas.filter((f) => f.saldo_real != null && desc(f.descuadre) !== 0);

  if (pendientes.length === 0 && descuadrados.length === 0) {
    return (
      <div className="cuadre-banner cuadre-banner--ok">
        <svg className="cuadre-check" width="48" height="48" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="23" />
          <path d="M15 27 L23 35 L38 18" />
        </svg>
        <div className="cuadre-banner__txt">
          <strong>Cuadra ✓</strong>
          <span>Todas las ubicaciones coinciden con su saldo teórico.</span>
        </div>
      </div>
    );
  }

  if (descuadrados.length > 0) {
    return (
      <div className="cuadre-banner cuadre-banner--off">
        <div className="cuadre-banner__txt">
          <strong>Descuadre detectado</strong>
          {descuadrados.map((f) => {
            const d = desc(f.descuadre);
            return (
              <span key={f.ubicacion_id}>
                {f.nombre}: {d > 0 ? 'sobran' : 'faltan'} {mxn(Math.abs(d))}
              </span>
            );
          })}
          {pendientes.length > 0 && <span>Faltan arqueos en: {pendientes.map((f) => f.nombre).join(', ')}.</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="cuadre-banner cuadre-banner--pend">
      <div className="cuadre-banner__txt">
        <strong>Cuadre pendiente</strong>
        <span>Registra el conteo real de: {pendientes.map((f) => f.nombre).join(', ')}.</span>
      </div>
    </div>
  );
}

function CuadreView({ ref_, semana, filas, onChange }: { ref_: Referencias; semana: Semana; filas: FilaCuadre[]; onChange: () => void }) {
  const [ubic, setUbic] = useState<number>(ref_.ubicaciones[0]?.id ?? 0);
  const [monto, setMonto] = useState('');
  const desc = (n: number | null) => (n == null ? 0 : Math.round(n * 100) / 100);
  return (
    <>
      <CuadreBanner filas={filas} />
      {filas.map((f) => {
        const d = desc(f.descuadre);
        const sinArqueo = f.saldo_real == null;
        const chip = sinArqueo ? 'chip chip--warn' : d === 0 ? 'chip chip--ok' : 'chip chip--danger';
        const etiqueta = sinArqueo ? 'Sin arqueo' : d === 0 ? 'Cuadra' : d > 0 ? `Sobran ${mxn(Math.abs(d))}` : `Faltan ${mxn(Math.abs(d))}`;
        return (
          <div key={f.ubicacion_id} className="resumen-card cuadre-loc">
            <div className="kv">
              <strong>{f.nombre}</strong>
              <span className={chip}>{etiqueta}</span>
            </div>
            <div className="kv"><span className="muted">Teórico</span><span className="saldo-real">{mxn(f.saldo_teorico)}</span></div>
            <div className="kv"><span className="muted">Inicial</span><span className="saldo-real">{mxn(f.saldo_inicial)}</span></div>
            {!sinArqueo && <div className="kv"><span className="muted">Real contado</span><span className="saldo-real">{mxn(f.saldo_real ?? 0)}</span></div>}
          </div>
        );
      })}
      {semana.estado === 'abierta' && (
        <div className="form-mov">
          <strong>Registrar arqueo (conteo real)</strong>
          <select value={ubic} onChange={(e) => setUbic(Number(e.target.value))}>
            {ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <input type="number" inputMode="decimal" placeholder="Monto real contado" value={monto} onChange={(e) => setMonto(e.target.value)} />
          <button className="btn-primary" onClick={async () => {
            await finanzas.crearArqueo({ semana_id: semana.id, ubicacion_id: ubic, monto_real: Number(monto) });
            setMonto(''); onChange();
          }}>Guardar arqueo</button>
        </div>
      )}
    </>
  );
}

function MovimientosView({ ref_, semana, movs, onChange }: { ref_: Referencias; semana: Semana; movs: Movimiento[]; onChange: () => void }) {
  const nombreUbic = (id: number | null) => ref_.ubicaciones.find((u) => u.id === id)?.nombre ?? '';
  const confirmar = useConfirm();
  const [editando, setEditando] = useState<number | null>(null);
  const [montoEdit, setMontoEdit] = useState('');
  const [origenEdit, setOrigenEdit] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);
  const [errorEdit, setErrorEdit] = useState('');

  function exportar() {
    descargarCSV(
      `movimientos-${semana.etiqueta}`,
      ['Tipo', 'Monto', 'Origen', 'Destino', 'Categoría', 'Facturado', 'Descripción'],
      movs.map((m) => [
        TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo,
        m.monto,
        nombreUbic(m.ubicacion_origen_id),
        nombreUbic(m.ubicacion_destino_id),
        '',
        m.facturado ? 'sí' : 'no',
        m.descripcion ?? '',
      ]),
    );
  }

  return (
    <>
      {semana.estado === 'abierta' && <FormMovimiento ref_={ref_} semana={semana} onSaved={onChange} />}
      {movs.length > 0 && (
        <button className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={exportar}>Exportar CSV</button>
      )}
      <ul className="conteo-list" style={{ marginTop: '1rem' }}>
        {movs.length === 0 && <li className="muted" style={{ padding: '1rem' }}>Sin movimientos aún.</li>}
        {movs.map((m) => (
          <li key={m.id} className="conteo-row">
            {editando === m.id ? <div className="conteo-info" style={{ display: 'grid', gap: '0.4rem' }}>
              <strong>Editar {TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo}</strong>
              <input type="number" min="0.01" step="0.01" value={montoEdit} onChange={(e) => setMontoEdit(e.target.value)} aria-label="Monto del movimiento" />
              <select value={origenEdit} onChange={(e) => setOrigenEdit(e.target.value ? Number(e.target.value) : '')} aria-label="Origen del gasto">
                <option value="">Origen…</option>{ref_.ubicaciones.filter((u) => u.tipo === 'efectivo' || u.tipo === 'banco').map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}
              </select>
              {errorEdit && <small className="error-msg">{errorEdit}</small>}
              <div style={{ display: 'flex', gap: '0.4rem' }}><button className="btn-primary" disabled={guardando} onClick={async () => { setGuardando(true); setErrorEdit(''); try { await finanzas.editarMovimiento(m.id, { monto: Number(montoEdit), ubicacion_origen_id: origenEdit || null }); setEditando(null); onChange(); } catch (e) { setErrorEdit(e instanceof Error ? e.message : 'No se pudo editar'); } finally { setGuardando(false); } }}>Guardar</button><button className="btn-ghost" onClick={() => setEditando(null)}>Cancelar</button></div>
            </div> : <><div className="conteo-info">
              <strong>{TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo}</strong>
              <small className="muted">
                {[nombreUbic(m.ubicacion_origen_id), nombreUbic(m.ubicacion_destino_id)].filter(Boolean).join(' → ')}
                {m.descripcion ? ` · ${m.descripcion}` : ''}{m.facturado ? ' · facturado' : ''}
              </small>
            </div><span>{mxn(m.monto)}</span></>}
            {semana.estado === 'abierta' && (
              <>{(m.tipo === 'gasto' || m.tipo === 'sueldo') && editando !== m.id && <button className="btn-ghost" title="Editar gasto" onClick={() => { setEditando(m.id); setMontoEdit(String(m.monto)); setOrigenEdit(m.ubicacion_origen_id ?? ''); setErrorEdit(''); }}>Editar</button>}<button
                className="icon-btn" title="Borrar movimiento" aria-label="Borrar movimiento"
                onClick={async () => { const ok = await confirmar({ message: '¿Borrar este movimiento? Afecta el cuadre de la semana.', tone: 'danger', confirmText: 'Borrar' }); if (!ok) return; try { await finanzas.borrarMovimiento(m.id); onChange(); } catch (e) { setErrorEdit(e instanceof Error ? e.message : 'No se pudo borrar'); } }}
              >✕</button></>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function FormMovimiento({ ref_, semana, onSaved }: { ref_: Referencias; semana: Semana; onSaved: () => void }) {
  const [tipo, setTipo] = useState<TipoMov>('venta_efectivo');
  const [monto, setMonto] = useState('');
  const [origen, setOrigen] = useState<number | ''>('');
  const [destino, setDestino] = useState<number | ''>('');
  const [categoria, setCategoria] = useState<number | ''>('');
  const [socio, setSocio] = useState<number | ''>('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const regla = ref_.reglas[tipo];

  async function guardar() {
    setError('');
    try {
      await finanzas.crearMovimiento({
        semana_id: semana.id, tipo, monto: Number(monto),
        ubicacion_origen_id: regla.requiereOrigen || origen !== '' ? origen || null : null,
        ubicacion_destino_id: regla.requiereDestino || destino !== '' ? destino || null : null,
        categoria_id: categoria || null, socio_id: socio || null,
        descripcion: desc || undefined,
      });
      setMonto(''); setDesc(''); setOrigen(''); setDestino(''); setCategoria(''); setSocio('');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <div className="form-mov">
      <strong>Registrar movimiento</strong>
      <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMov)}>
        {TIPOS.map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
      </select>
      <input type="number" inputMode="decimal" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
      {regla.requiereOrigen && (
        <select value={origen} onChange={(e) => setOrigen(Number(e.target.value))}>
          <option value="">— Origen —</option>
          {ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      )}
      {regla.requiereDestino && (
        <select value={destino} onChange={(e) => setDestino(Number(e.target.value))}>
          <option value="">— Destino —</option>
          {ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      )}
      {regla.requiereCategoria && (
        <select value={categoria} onChange={(e) => setCategoria(Number(e.target.value))}>
          <option value="">— Categoría —</option>
          {ref_.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      )}
      {(regla.requiereSocio || tipo === 'transferencia') && (
        <select value={socio} onChange={(e) => setSocio(Number(e.target.value))}>
          <option value="">— Socio {regla.requiereSocio ? '' : '(si va a caja fuerte)'} —</option>
          {ref_.socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      )}
      <input placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      {error && <p className="error-msg">{error}</p>}
      <button className="btn-primary" onClick={guardar}>Agregar</button>
    </div>
  );
}
