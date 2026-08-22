import { useEffect, useState } from 'react';
import {
  finanzas, epos, mxn, TIPOS, type Referencias, type Semana, type Resumen, type FilaCuadre,
  type Movimiento, type TipoMov, type DiaFila, type ConciliacionDiaria, type EposVenta, type CompraDetalle, type CompraDetalleLinea,
} from './api';
import { Icono } from '../../icons';
import { descargarCSV } from '../../csv';
import { useConfirm } from '../../ui/ConfirmProvider';
import { useToast } from '../../ui/ToastProvider';
import { Cargando } from '../../ui/Cargando';
import { api } from '../../api';
import { CapturaRapida } from '../compras/Compras';

interface ProductoCompra { id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null }

function presentacionCompra(p: ProductoCompra) {
  if (p.contenido_compra == null && !p.unidad_compra) return p.unidad_base ? `unidad base: ${p.unidad_base}` : 'presentación pendiente';
  const contenido = p.contenido_compra == null ? '' : `${Number.isInteger(p.contenido_compra) ? p.contenido_compra : p.contenido_compra.toLocaleString('es-MX', { maximumFractionDigits: 3 })} ${p.unidad_base ?? ''}`.trim();
  return [contenido, p.unidad_compra ? `por ${p.unidad_compra}` : ''].filter(Boolean).join(' ');
}

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
        <h1>Operación</h1>
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
      <nav className="tabs" aria-label="Flujo semanal">
        <button className={tab === 'dia' ? 'tab tab--on' : 'tab'} onClick={() => setTab('dia')}>Operación diaria</button>
        <button className={tab === 'resumen' ? 'tab tab--on' : 'tab'} onClick={() => setTab('resumen')}>Resumen</button>
        <button className={tab === 'movs' ? 'tab tab--on' : 'tab'} onClick={() => setTab('movs')}>Registro único</button>
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
        <span className="muted">Operación viernes a domingo · ventas de la semana</span>
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
      {operativos.map((d) => (
        <DiaCard key={d.fecha} semana={semana} dia={d} abierta={abierta} operativo conciliacion={conciliaciones.find((c) => c.fecha === d.fecha)} onSaved={onChange} />
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
  const [ventasDetalle, setVentasDetalle] = useState<EposVenta[]>([]);
  const [verVentas, setVerVentas] = useState(false);
  const [cargandoVentas, setCargandoVentas] = useState(false);
  const [correccionManual, setCorreccionManual] = useState(false);
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
  const egresos = dia.total_egresos;

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
      await cargarVentasDetalle();
    } catch (e) {
      error(e instanceof Error ? e.message : 'No se pudo consultar Epos');
    } finally { setConsultandoEpos(false); }
  }

  async function cargarVentasDetalle() {
    setCargandoVentas(true);
    try {
      const desde = `${dia.fecha}T00:00:00-06:00`;
      const hasta = `${sumarDias(dia.fecha, 1)}T00:00:00-06:00`;
      setVentasDetalle(await epos.ventas(desde, hasta));
      setVerVentas(true);
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo cargar el detalle de ventas'); }
    finally { setCargandoVentas(false); }
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

  const campo = (emoji: string, label: string, val: string, set: (v: string) => void, bloqueado = !abierta) => (
    <label>{emoji} {label}<input type="number" inputMode="decimal" value={val} disabled={bloqueado} onChange={(e) => set(e.target.value)} placeholder="0" /></label>
  );

  return (
    <div className="dia-card">
      <div className="dia-card__head">
        <strong>{dia.dia} <span className="muted">{dia.fecha.slice(5)}</span></strong>
        <span className="muted">ventas {mxn(ventas)}{egresos ? ` · egresos ${mxn(egresos)}` : ''}</span>
      </div>
      {operativo && <>
        <div className="dia-section muted">Ventas <span className={conciliacion ? 'badge-ok' : eposCorte ? 'badge-info' : 'badge-neutral'}>{conciliacion ? 'Corte confirmado' : eposCorte ? 'Ventas importadas · revisar' : 'Pendiente de importar'}</span></div>
        <div className="dia-inputs">
          {campo('💵', 'Efectivo', efectivo, setEfectivo, !abierta || (!!eposCorte && !correccionManual))}
          {campo('💳', 'Tarjeta', tarjeta, setTarjeta, !abierta || (!!eposCorte && !correccionManual))}
          {campo('🎁', 'Propina', propina, setPropina, !abierta || (!!eposCorte && !correccionManual))}
        </div>
        {abierta && (
          <div style={{ marginTop: '0.6rem' }}>
            <button className="pill" onClick={consultarEpos} disabled={consultandoEpos}>
              {consultandoEpos ? 'Importando ventas…' : eposCorte ? 'Actualizar ventas Epos' : 'Importar ventas Epos'}
            </button>
            <button className="btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => void cargarVentasDetalle()} disabled={cargandoVentas}>
              {cargandoVentas ? 'Cargando detalle…' : verVentas ? 'Actualizar productos vendidos' : 'Ver productos vendidos'}
            </button>
            {eposNota && <small className="muted" style={{ display: 'block', marginTop: '0.4rem' }}>{eposNota}</small>}
            {eposCorte && <button className="link-btn" style={{ marginTop: '0.45rem' }} onClick={() => setCorreccionManual((v) => !v)}>{correccionManual ? 'Ocultar corrección manual' : 'Corregir manualmente'}</button>}
            {eposCorte && <>
              <label className="inline-field">Cuentas abiertas al cierre
                <input type="number" min="0" step="1" value={cuentasAbiertas} onChange={(e) => setCuentasAbiertas(e.target.value)} />
              </label>
              <button className="btn-primary" style={{ marginTop: '0.55rem' }} onClick={() => void confirmarCorte()}>Confirmar corte y guardar</button>
            </>}
          </div>
        )}
        {verVentas && <DetalleVentasEpos filas={ventasDetalle} />}
      </>}
      <div className="dia-section muted">Compras y egresos del día</div>
      {(dia.gasto_itemizado > 0 || dia.compra_inventario > 0) && (
        <div className="info-box info-box--compact">
          <strong>Egresos registrados:</strong>{dia.compra_inventario ? ` inventario FIFO ${mxn(dia.compra_inventario)}` : ''}{dia.compra_inventario && dia.gasto_itemizado ? ' ·' : ''}{dia.gasto_itemizado ? ` gastos con ticket ${mxn(dia.gasto_itemizado)}` : ''}
        </div>
      )}
      <div className="dia-inputs dia-inputs--2">
        {campo('🧾', 'Gasto sin ticket', gasto, setGasto)}
        {campo('👷', 'Sueldos', sueldos, setSueldos)}
      </div>
      {abierta && (
        <div className="dia-actions">
          <button className="btn-primary dia-save" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar día'}
          </button>
        </div>
      )}
    </div>
  );
}

function DetalleVentasEpos({ filas }: { filas: EposVenta[] }) {
  const porProducto = new Map<string, { cantidad: number; venta: number; costo: number; costeadas: boolean; excepciones: number }>();
  const porMetodo = new Map<string, number>();
  filas.forEach((fila) => {
    const previo = porProducto.get(fila.producto) ?? { cantidad: 0, venta: 0, costo: 0, costeadas: true, excepciones: 0 };
    const costo = fila.costo_fifo ?? 0;
    porProducto.set(fila.producto, {
      cantidad: previo.cantidad + fila.cantidad,
      venta: previo.venta + (fila.venta_neta ?? fila.venta_bruta),
      costo: previo.costo + costo,
      costeadas: previo.costeadas && fila.costo_fifo != null,
      excepciones: previo.excepciones + (fila.costeo_estado === 'excepcion' ? 1 : 0),
    });
    porMetodo.set(fila.metodo_pago, (porMetodo.get(fila.metodo_pago) ?? 0) + (fila.venta_neta ?? fila.venta_bruta));
  });
  const productos = [...porProducto.entries()].sort((a, b) => b[1].venta - a[1].venta);
  if (!filas.length) return <div className="info-box info-box--compact"><strong>No hay ventas persistidas para este día.</strong><span className="muted">Importa Epos o revisa el rango de la semana.</span></div>;
  return <details className="ventas-detalle" open>
    <summary><strong>Detalle de ventas Epos</strong><span className="muted">{filas.length} líneas · {productos.length} productos</span></summary>
    <div className="ventas-detalle__summary">
      {[...porMetodo.entries()].map(([metodo, total]) => <span key={metodo}><small>{metodo}</small><strong>{mxn(total)}</strong></span>)}
    </div>
    <div className="ventas-detalle__table table-wrap"><table><thead><tr><th>Producto</th><th>Unidades</th><th>Venta</th><th>Costo FIFO</th><th>Estado</th></tr></thead><tbody>
      {productos.map(([producto, dato]) => <tr key={producto}><td><strong>{producto}</strong></td><td>{dato.cantidad}</td><td>{mxn(dato.venta)}</td><td>{dato.costeadas ? mxn(dato.costo) : 'Pendiente'}</td><td>{dato.excepciones ? <span className="status status--danger">{dato.excepciones} excepción(es)</span> : <span className="status status--ok">Revisado</span>}</td></tr>)}
    </tbody></table></div>
  </details>;
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
  const [destinoEdit, setDestinoEdit] = useState<number | ''>('');
  const [categoriaEdit, setCategoriaEdit] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);
  const [errorEdit, setErrorEdit] = useState('');
  const [compraEditando, setCompraEditando] = useState<number | null>(null);

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
      <section className="info-box unified-operations-intro">
        <strong>Registro único de operaciones</strong>
        <p className="muted">Una compra confirmada crea su lote FIFO y su movimiento financiero al mismo tiempo. Aquí se revisan juntos compras, egresos, ventas, depósitos y transferencias; no vuelvas a capturar una compra en esta pantalla.</p>
      </section>
      {semana.estado === 'abierta' && <details className="operation-capture">
        <summary><strong>Registrar compra con ticket</strong><span className="muted">Captura, revisión y confirmación en el mismo flujo</span></summary>
        <div className="operation-capture__body"><CapturaRapida fechaInicial={semana.fecha_inicio} onSaved={onChange} /></div>
      </details>}
      {semana.estado === 'abierta' && <details className="operation-adjustment">
        <summary><strong>Añadir ajuste manual</strong><span className="muted">Solo para correcciones, transferencias o movimientos que no provienen de un ticket</span></summary>
        <FormMovimiento ref_={ref_} semana={semana} onSaved={onChange} />
      </details>}
      {movs.length > 0 && (
        <button className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={exportar}>Exportar registro</button>
      )}
      <h3 className="section-title" style={{ marginTop: '1.25rem' }}>Historial de operaciones</h3>
      <ul className="conteo-list" style={{ marginTop: '1rem' }}>
        {movs.length === 0 && <li className="muted" style={{ padding: '1rem' }}>Sin operaciones registradas aún.</li>}
        {movs.map((m) => (
          <li key={m.id} className="conteo-row">
            {editando === m.id ? <div className="conteo-info" style={{ display: 'grid', gap: '0.4rem' }}>
              <strong>Editar {TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo}</strong>
              <input type="number" min="0.01" step="0.01" value={montoEdit} onChange={(e) => setMontoEdit(e.target.value)} aria-label="Monto del movimiento" />
              <select value={origenEdit} onChange={(e) => setOrigenEdit(e.target.value ? Number(e.target.value) : '')} aria-label="Origen del movimiento">
                <option value="">Origen…</option>{ref_.ubicaciones.filter((u) => u.tipo === 'efectivo' || u.tipo === 'banco').map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}
              </select>
              <select value={destinoEdit} onChange={(e) => setDestinoEdit(e.target.value ? Number(e.target.value) : '')} aria-label="Destino del movimiento">
                <option value="">Destino…</option>{ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}
              </select>
              {m.tipo === 'gasto' && <select value={categoriaEdit} onChange={(e) => setCategoriaEdit(e.target.value ? Number(e.target.value) : '')} aria-label="Categoría del gasto">
                <option value="">Categoría…</option>{ref_.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>}
              {errorEdit && <small className="error-msg">{errorEdit}</small>}
              <div style={{ display: 'flex', gap: '0.4rem' }}><button className="btn-primary" disabled={guardando} onClick={async () => { setGuardando(true); setErrorEdit(''); try { await finanzas.editarMovimiento(m.id, { monto: Number(montoEdit), ubicacion_origen_id: origenEdit || null, ubicacion_destino_id: destinoEdit || null, categoria_id: categoriaEdit || null }); setEditando(null); onChange(); } catch (e) { setErrorEdit(e instanceof Error ? e.message : 'No se pudo editar'); } finally { setGuardando(false); } }}>Guardar</button><button className="btn-ghost" onClick={() => setEditando(null)}>Cancelar</button></div>
            </div> : <><div className="conteo-info">
              <strong>{m.compra_id != null || m.tipo === 'compra_inventario' ? 'Compra · movimiento vinculado' : TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo}</strong>
              <small className="muted">
                {[nombreUbic(m.ubicacion_origen_id), nombreUbic(m.ubicacion_destino_id)].filter(Boolean).join(' → ')}
                {m.descripcion ? ` · ${m.descripcion}` : ''}{m.facturado ? ' · facturado' : ''}
              </small>
            </div><span>{mxn(m.monto)}</span></>}
            {semana.estado === 'abierta' && (
              <>{editando !== m.id && (m.compra_id != null ? <button className="btn-ghost" title="Editar compra y movimiento vinculado" onClick={() => setCompraEditando(m.compra_id!)}>Editar compra</button> : <button className="btn-ghost" title="Editar movimiento" onClick={() => { setEditando(m.id); setMontoEdit(String(m.monto)); setOrigenEdit(m.ubicacion_origen_id ?? ''); setDestinoEdit(m.ubicacion_destino_id ?? ''); setCategoriaEdit(m.categoria_id ?? ''); setErrorEdit(''); }}>Editar</button>)}{m.compra_id == null && <button
                className="icon-btn" title="Borrar movimiento" aria-label="Borrar movimiento"
                onClick={async () => { const ok = await confirmar({ message: '¿Borrar este movimiento? Afecta el cuadre de la semana.', tone: 'danger', confirmText: 'Borrar' }); if (!ok) return; try { await finanzas.borrarMovimiento(m.id); onChange(); } catch (e) { setErrorEdit(e instanceof Error ? e.message : 'No se pudo borrar'); } }}
              >✕</button>}</>
            )}
          </li>
        ))}
      </ul>
      {compraEditando != null && <CompraEditorV2 compraId={compraEditando} ref_={ref_} onClose={() => setCompraEditando(null)} onSaved={() => { setCompraEditando(null); onChange(); }} />}
    </>
  );
}

function CompraEditor({ compraId, ref_, onClose, onSaved }: { compraId: number; ref_: Referencias; onClose: () => void; onSaved: () => void }) {
  const [compra, setCompra] = useState<CompraDetalle | null>(null);
  const [lineas, setLineas] = useState<CompraDetalleLinea[]>([]);
  const [total, setTotal] = useState('');
  const [origen, setOrigen] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { finanzas.obtenerCompra(compraId).then((c) => { setCompra(c); setLineas(c.lineas); setTotal(String(c.total)); setOrigen(c.origen_pago_id ?? ''); }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el ticket.')); }, [compraId]);
  function editar(i: number, campo: keyof CompraDetalleLinea, valor: string) { setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: campo === 'cantidad_base' || campo === 'importe' || campo === 'costo_unitario' ? (valor === '' ? null : Number(valor)) : valor } : l)); }
  async function guardar() {
    if (!compra || !origen || !lineas.length) return;
    setGuardando(true); setError('');
    try { await finanzas.editarCompra(compra.id, { total: Number(total), origen_pago_id: Number(origen), lineas: lineas.map((l) => ({ ...l, id: undefined, producto: undefined, product_id: l.product_id, cantidad_base: l.cantidad_base, importe: Number(l.importe), costo_unitario: l.costo_unitario })) }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el ticket.'); }
    finally { setGuardando(false); }
  }
  return <section className="card movement-purchase-editor" style={{ marginTop: '1rem' }}><div className="section-heading"><div><h3>Editar compra vinculada</h3><p className="muted">Las cantidades, importes y movimientos se actualizan juntos.</p></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar editor">✕</button></div>{!compra && !error && <Cargando etiqueta="Cargando ticket…" />}{compra && <><div className="form-grid form-grid--three"><label>Total del ticket<input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} /></label><label>Pago desde<select value={origen} onChange={(e) => setOrigen(e.target.value ? Number(e.target.value) : '')}>{ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}</select></label></div><div className="quick-lines">{lineas.map((l, i) => <div className="quick-line" key={l.id ?? `${compra.id}-${i}`}><strong>{l.producto || l.descripcion_fuente}</strong><small className="muted">{l.tipo_linea === 'inventario' ? 'Inventario FIFO' : 'Gasto operativo'}</small><input value={l.descripcion_fuente} onChange={(e) => editar(i, 'descripcion_fuente', e.target.value)} aria-label={`Descripción línea ${i + 1}`} /><div className="quick-line__numbers"><input type="number" min="0" step="any" value={l.cantidad_base ?? ''} onChange={(e) => editar(i, 'cantidad_base', e.target.value)} aria-label={`Cantidad línea ${i + 1}`} /><input type="number" min="0" step="0.01" value={l.importe} onChange={(e) => editar(i, 'importe', e.target.value)} aria-label={`Importe línea ${i + 1}`} /></div></div>)}</div>{error && <div className="error-msg">{error}</div>}<div className="sticky-action"><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar ticket y movimientos'}</button></div></>}</section>;
}

function CompraEditorV2({ compraId, ref_, onClose, onSaved }: { compraId: number; ref_: Referencias; onClose: () => void; onSaved: () => void }) {
  const [compra, setCompra] = useState<CompraDetalle | null>(null);
  const [lineas, setLineas] = useState<CompraDetalleLinea[]>([]);
  const [productos, setProductos] = useState<ProductoCompra[]>([]);
  const [total, setTotal] = useState('');
  const [origen, setOrigen] = useState<number | ''>('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    Promise.all([
      finanzas.obtenerCompra(compraId),
      api<ProductoCompra[]>('/catalogo/products'),
    ]).then(([c, p]) => {
      setCompra(c);
      setLineas(c.lineas);
      setTotal(String(c.total));
      setOrigen(c.origen_pago_id ?? '');
      setProductos(p);
    }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el ticket.'));
  }, [compraId]);

  function editar(i: number, campo: keyof CompraDetalleLinea, valor: string) {
    const numerico = campo === 'cantidad_base' || campo === 'contenido_compra' || campo === 'importe' || campo === 'costo_unitario';
    setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: numerico ? (valor === '' ? null : Number(valor)) : valor } : l));
  }

  function seleccionarProducto(i: number, valor: string) {
    const productId = valor ? Number(valor) : null;
    const producto = productos.find((p) => p.id === productId);
    setLineas((v) => v.map((l, idx) => idx === i ? {
      ...l,
      product_id: productId,
      producto: producto?.nombre ?? null,
      unidad_compra: producto?.unidad_compra ?? l.unidad_compra,
      contenido_compra: producto?.contenido_compra ?? l.contenido_compra,
      descripcion_fuente: l.descripcion_fuente || producto?.nombre || '',
    } : l));
  }

  function agregarLinea() {
    setLineas((v) => [...v, { id: null, product_id: null, producto: null, tipo_linea: 'inventario', descripcion_fuente: '', cantidad_base: null, unidad_compra: null, contenido_compra: null, costo_unitario: null, importe: 0, confianza: 1, notas: null }]);
  }

  async function guardar() {
    if (!compra || !origen || !lineas.length) return;
    setGuardando(true); setError('');
    try {
      await finanzas.editarCompra(compra.id, {
        total: Number(total), origen_pago_id: Number(origen),
        lineas: lineas.map((l) => ({
          ...l,
          id: undefined,
          producto: undefined,
          descripcion_fuente: l.descripcion_fuente.trim() || l.producto || 'Línea nueva',
          product_id: l.product_id,
          cantidad_base: l.cantidad_base,
          importe: Number(l.importe),
          costo_unitario: l.costo_unitario,
        })),
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el ticket.'); }
    finally { setGuardando(false); }
  }

  return <section className="card movement-purchase-editor" style={{ marginTop: '1rem' }}>
    <div className="section-heading"><div><h3>Editar compra vinculada</h3><p className="muted">Las líneas, cantidades, costos y movimientos se actualizan juntos.</p></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar editor">✕</button></div>
    {!compra && !error && <Cargando etiqueta="Cargando ticket…" />}
    {compra && <>
      <div className="form-grid form-grid--three"><label>Total del ticket<input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} /></label><label>Pago desde<select value={origen} onChange={(e) => setOrigen(e.target.value ? Number(e.target.value) : '')}>{ref_.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}</select></label></div>
      <div className="quick-lines">{lineas.map((l, i) => { const producto = productos.find((p) => p.id === l.product_id); return <div className="quick-line" key={l.id ?? `${compra.id}-${i}`}>
        <div className="quick-line__head"><strong>Línea {i + 1}{l.producto ? ` · ${l.producto}` : ''}</strong><button className="btn-ghost" onClick={() => setLineas((v) => v.filter((_, idx) => idx !== i))} disabled={lineas.length === 1}>Quitar</button></div>
        <input value={l.descripcion_fuente} placeholder="Descripción de la fuente" onChange={(e) => editar(i, 'descripcion_fuente', e.target.value)} aria-label={`Descripción línea ${i + 1}`} />
        <select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value)}><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option><option value="pendiente">Pendiente</option></select>
        {l.tipo_linea === 'inventario' && <><select value={l.product_id ?? ''} onChange={(e) => seleccionarProducto(i, e.target.value)}><option value="">Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {presentacionCompra(p)}</option>)}</select>{producto && <small className="quick-line__presentation">Presentación configurada: {presentacionCompra(producto)}</small>}</>}
        <div className="quick-line__numbers"><input type="number" min="0" step="any" value={l.cantidad_base ?? ''} placeholder="Cantidad base" onChange={(e) => editar(i, 'cantidad_base', e.target.value)} aria-label={`Cantidad línea ${i + 1}`} /><input value={l.unidad_compra ?? ''} placeholder="Unidad de compra" onChange={(e) => editar(i, 'unidad_compra', e.target.value)} aria-label={`Unidad línea ${i + 1}`} /><input type="number" min="0" step="any" value={l.contenido_compra ?? ''} placeholder="Contenido por compra" onChange={(e) => editar(i, 'contenido_compra', e.target.value)} aria-label={`Contenido por compra línea ${i + 1}`} /><input type="number" min="0" step="0.01" value={l.costo_unitario ?? ''} placeholder="Costo unitario" onChange={(e) => editar(i, 'costo_unitario', e.target.value)} aria-label={`Costo unitario línea ${i + 1}`} /><input type="number" min="0" step="0.01" value={l.importe} placeholder="Importe" onChange={(e) => editar(i, 'importe', e.target.value)} aria-label={`Importe línea ${i + 1}`} /></div>
      </div>; })}</div>
      {error && <div className="error-msg">{error}</div>}
      <div className="sticky-action"><button className="btn-secondary" onClick={agregarLinea}>Agregar línea</button><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar ticket y movimientos'}</button></div>
    </>}
    {!compra && error && <div className="error-msg">{error}</div>}
  </section>;
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
