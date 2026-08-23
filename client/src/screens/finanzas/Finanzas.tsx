import { useEffect, useState } from 'react';
import {
  finanzas, epos, mxn, TIPOS, type Referencias, type Semana, type Resumen, type FilaCuadre,
  type Movimiento, type TipoMov, type DiaFila, type ConciliacionDiaria, type EposVenta, type CompraDetalle, type CompraDetalleLinea,
  type CosteoVentaPreview,
} from './api';
import { Icono } from '../../icons';
import { descargarCSV } from '../../csv';
import { useConfirm } from '../../ui/ConfirmProvider';
import { useToast } from '../../ui/ToastProvider';
import { Cargando } from '../../ui/Cargando';
import { api } from '../../api';
import { RegistroComprasPanel } from '../compras/Compras';
import { cantidadBaseDesdePresentacion, conversionCompraTexto, costoBase, formatoCantidad, presentacionTexto } from '../compras/fifo-form';

interface ProductoCompra { id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null; rendimiento_util?: number | null }

function presentacionCompra(p: ProductoCompra) {
  if (p.contenido_compra == null && !p.unidad_compra) return p.unidad_base ? `unidad base: ${p.unidad_base} · ${conversionCompraTexto(p)}` : 'presentación pendiente';
  const contenido = p.contenido_compra == null ? '' : `${Number.isInteger(p.contenido_compra) ? p.contenido_compra : p.contenido_compra.toLocaleString('es-MX', { maximumFractionDigits: 3 })} ${p.unidad_base ?? ''}`.trim();
  return `${[contenido, p.unidad_compra ? `por ${p.unidad_compra}` : ''].filter(Boolean).join(' ')} · ${conversionCompraTexto(p)}`;
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

type MetodoMixto = 'cash' | 'card';

function claveMetodoEpos(metodo: string) {
  return metodo.trim().toLowerCase().replace(/[\s_-]/g, '');
}

function esMetodoMixtoEpos(metodo: string) {
  const clave = claveMetodoEpos(metodo);
  return clave.includes('cash') && clave.includes('card');
}

function resumirMetodosEpos(metodos: { metodo: string; total: number }[]) {
  return metodos.reduce((resumen, item) => {
    const clave = claveMetodoEpos(item.metodo);
    if (clave === 'cash') resumen.efectivo += item.total;
    else if (clave === 'card') resumen.tarjeta += item.total;
    else if (esMetodoMixtoEpos(item.metodo)) resumen.mixto += item.total;
    else resumen.noReconocido += item.total;
    return resumen;
  }, { efectivo: 0, tarjeta: 0, mixto: 0, noReconocido: 0 });
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
        <button className={tab === 'movs' ? 'tab tab--on' : 'tab'} onClick={() => setTab('movs')}>Compras</button>
        <button className={tab === 'cuadre' ? 'tab tab--on' : 'tab'} onClick={() => setTab('cuadre')}>Cuadre</button>
      </nav>

      {tab === 'dia' && <DiaView semana={semana} dias={dias} conciliaciones={conciliaciones} onChange={cargar} />}
      {tab === 'resumen' && resumen && <ResumenView r={resumen} semana={semana} onCambio={cargar} />}
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
          try {
            await finanzas.cerrar(semana.id); onCambio(); cargar();
          } catch (e) {
            const mensaje = e instanceof Error ? e.message : 'No se pudo cerrar la semana';
            if (!mensaje.toLowerCase().includes('excepciones de costeo')) {
              error(mensaje);
              return;
            }
            const continuar = await confirmar({
              message: `${mensaje} Si cierras ahora, quedarán registradas como excepciones y no se descontará inventario para esas ventas. ¿Confirmas el cierre con esta evidencia pendiente?`,
              tone: 'danger', confirmText: 'Cerrar con excepciones', cancelText: 'Seguir revisando',
            });
            if (!continuar) return;
            try { await finanzas.cerrar(semana.id, { confirmar_excepciones: true }); onCambio(); cargar(); }
            catch (errorCierre) { error(errorCierre instanceof Error ? errorCierre.message : 'No se pudo cerrar la semana'); }
          }
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
  const [eposMetodos, setEposMetodos] = useState({ efectivo: 0, tarjeta: 0, mixto: 0, noReconocido: 0 });
  const [eposMetodoMixto, setEposMetodoMixto] = useState<MetodoMixto | null>(null);
  const [ventasDetalle, setVentasDetalle] = useState<EposVenta[]>([]);
  const [costeoPreview, setCosteoPreview] = useState<Map<number, CosteoVentaPreview>>(new Map());
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
      const metodos = resumirMetodosEpos(corte.bookkeeping.metodos_pago);
      setEposCorte(corte);
      setEposMetodos(metodos);
      setEposMetodoMixto(null);
      setEfectivo(String(metodos.efectivo));
      setTarjeta(String(metodos.tarjeta));
      const avisos = [
        metodos.mixto > 0 ? `${mxn(metodos.mixto)} aparece como Card/Cash y debe clasificarse` : '',
        metodos.noReconocido > 0 ? `${mxn(metodos.noReconocido)} con método Epos no reconocido` : '',
      ].filter(Boolean);
      setEposNota(`Importado: ${mxn(corte.bookkeeping.ventas)} · ${avisos.length ? `${avisos.join(' · ')} · ` : ''}revisa y confirma`);
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
      const ventas = await epos.ventas(desde, hasta);
      setVentasDetalle(ventas);
      // Vista previa pura: calcula el costo con los lotes abiertos sin
      // consumirlos. Así ventas muestra lo que ya está aplicado y lo que
      // puede aplicarse, sin pedir una nueva validación de la receta.
      try {
        const preview = await epos.costeoPreview(desde, hasta);
        setCosteoPreview(new Map(preview.detalle.map((detalle) => [detalle.venta_id, detalle])));
      } catch {
        setCosteoPreview(new Map());
      }
      setVerVentas(true);
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo cargar el detalle de ventas'); }
    finally { setCargandoVentas(false); }
  }

  async function confirmarCorte() {
    if (!eposCorte) return;
    if (eposMetodos.mixto > 0 && !eposMetodoMixto) {
      setEposNota(`Clasifica ${mxn(eposMetodos.mixto)} de Card/Cash como efectivo o tarjeta antes de confirmar.`);
      return;
    }
    try {
      // La confirmación es el punto único que convierte la revisión del corte
      // en el registro diario financiero. El botón manual sigue disponible
      // cuando no se consultó Epos.
      await finanzas.guardarDia(semana.id, {
        fecha: dia.fecha, venta_efectivo: n(efectivo), venta_tarjeta: n(tarjeta),
        propina_tarjeta: n(propina), gasto_efectivo: n(gasto), sueldos: n(sueldos),
      });
      const efectivoEpos = eposMetodos.efectivo + (eposMetodoMixto === 'cash' ? eposMetodos.mixto : 0);
      const tarjetaEpos = eposMetodos.tarjeta + (eposMetodoMixto === 'card' ? eposMetodos.mixto : 0);
      const noReconocidoEpos = eposMetodos.noReconocido;
      const clasificacion = eposMetodos.mixto > 0 ? `Card/Cash clasificado como ${eposMetodoMixto === 'cash' ? 'efectivo' : 'tarjeta'}` : '';
      const notaFinal = [eposNota, clasificacion, noReconocidoEpos > 0 ? `Método Epos no reconocido: ${mxn(noReconocidoEpos)}` : ''].filter(Boolean).join(' · ');
      await epos.confirmarConciliacion({
        semana_id: semana.id,
        fecha: dia.fecha,
        epos: {
          ventas: eposCorte.bookkeeping.ventas,
          efectivo: efectivoEpos,
          tarjeta: tarjetaEpos,
          otros: noReconocidoEpos,
        },
        confirmado: { ventas: n(efectivo) + n(tarjeta) + n(propina), efectivo: n(efectivo), tarjeta: n(tarjeta), otros: noReconocidoEpos },
        cuentas_abiertas: n(cuentasAbiertas),
        excepciones: [],
        notas: notaFinal || undefined,
      });
      setEposNota('Corte confirmado y guardado como evidencia.');
      setEposCorte(null);
      onSaved();
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo confirmar el corte'); }
  }

  const campo = (emoji: string, label: string, val: string, set: (v: string) => void, bloqueado = !abierta) => (
    <label>{emoji} {label}<input type="number" inputMode="decimal" value={val} disabled={bloqueado} onChange={(e) => set(e.target.value)} placeholder="0" /></label>
  );
  const corteConfirmado = conciliacion != null;
  const importacionLabel = eposCorte
    ? 'Actualizar ventas Epos'
    : corteConfirmado
      ? 'Revisar ventas persistidas'
      : 'Importar ventas Epos';

  return (
    <div className="dia-card">
      <div className="dia-card__head">
        <strong>{dia.dia} <span className="muted">{dia.fecha.slice(5)}</span></strong>
        <span className="muted">ventas {mxn(ventas)}{egresos ? ` · egresos ${mxn(egresos)}` : ''}</span>
      </div>
      {operativo && <>
        <div className="dia-section muted">Ventas <span className={conciliacion ? 'badge-ok' : eposCorte ? 'badge-info' : 'badge-neutral'}>{conciliacion ? 'Corte confirmado' : eposCorte ? 'Ventas importadas · revisar' : 'Pendiente de importar'}</span></div>
        <div className="dia-inputs">
          {campo('💵', 'Efectivo', efectivo, setEfectivo, !abierta || (!!eposCorte && !correccionManual) || (!!corteConfirmado && !correccionManual))}
          {campo('💳', 'Tarjeta', tarjeta, setTarjeta, !abierta || (!!eposCorte && !correccionManual) || (!!corteConfirmado && !correccionManual))}
          {campo('🎁', 'Propina (manual)', propina, setPropina, !abierta || (!!corteConfirmado && !correccionManual))}
        </div>
        <small className="muted">La propina no viene de Epos; captúrala aquí sólo si aparece en el corte de la terminal.</small>
        {abierta && (
          <div style={{ marginTop: '0.6rem' }}>
            <button
              className="pill"
              onClick={() => corteConfirmado && !eposCorte ? void cargarVentasDetalle() : void consultarEpos()}
              disabled={consultandoEpos || (corteConfirmado && !eposCorte && cargandoVentas)}
            >
              {consultandoEpos ? 'Importando ventas…' : cargandoVentas && corteConfirmado && !eposCorte ? 'Cargando ventas…' : importacionLabel}
            </button>
            <button className="btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => void cargarVentasDetalle()} disabled={cargandoVentas}>
              {cargandoVentas ? 'Cargando detalle…' : verVentas ? 'Actualizar productos vendidos' : 'Ver productos vendidos'}
            </button>
            {eposNota && <small className="muted" style={{ display: 'block', marginTop: '0.4rem' }}>{eposNota}</small>}
            {eposCorte && <button className="link-btn" style={{ marginTop: '0.45rem' }} onClick={() => setCorreccionManual((v) => !v)}>{correccionManual ? 'Ocultar corrección manual' : 'Corregir manualmente'}</button>}
            {eposCorte && <>
              {eposMetodos.mixto > 0 && <div className="info-box info-box--compact epos-metodo-mixto">
                <strong>Clasifica el importe Card/Cash</strong>
                <span className="muted">Epos no indica si estos {mxn(eposMetodos.mixto)} fueron efectivo o tarjeta.</span>
                <div className="epos-metodo-mixto__actions">
                  <button className={eposMetodoMixto === 'cash' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setEposMetodoMixto('cash'); setEfectivo(String(eposMetodos.efectivo + eposMetodos.mixto)); setTarjeta(String(eposMetodos.tarjeta)); }}>Efectivo</button>
                  <button className={eposMetodoMixto === 'card' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setEposMetodoMixto('card'); setEfectivo(String(eposMetodos.efectivo)); setTarjeta(String(eposMetodos.tarjeta + eposMetodos.mixto)); }}>Tarjeta</button>
                </div>
              </div>}
              {eposMetodos.noReconocido > 0 && <div className="info-box info-box--compact"><strong>Hay métodos Epos no reconocidos por {mxn(eposMetodos.noReconocido)}.</strong><span className="muted">Revisa el origen antes de confirmar; no se asignarán silenciosamente a efectivo o tarjeta.</span></div>}
              <label className="inline-field">Cuentas abiertas al cierre
                <input type="number" min="0" step="1" value={cuentasAbiertas} onChange={(e) => setCuentasAbiertas(e.target.value)} />
              </label>
              <button className="btn-primary" style={{ marginTop: '0.55rem' }} disabled={eposMetodos.mixto > 0 && !eposMetodoMixto} onClick={() => void confirmarCorte()}>Confirmar corte y guardar</button>
            </>}
          </div>
        )}
        {conciliacion && <CorteConfirmado evidencia={conciliacion} propina={n(propina)} />}
        {verVentas && <DetalleVentasEpos filas={ventasDetalle} preview={costeoPreview} metodoMixto={eposMetodoMixto} />}
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

function CorteConfirmado({ evidencia, propina }: { evidencia: ConciliacionDiaria; propina: number }) {
  // Epos no reporta la propina como venta. La excluimos de la comparación para
  // no marcar una diferencia falsa cuando el corte sí la capturó manualmente.
  const diferencia = evidencia.confirmado.ventas - propina - evidencia.epos.ventas;
  const dinero = (value: number) => mxn(value);
  return <details className="epos-evidence">
    <summary><strong>Evidencia del corte confirmado</strong><span className="muted">{evidencia.confirmado_at ? new Date(evidencia.confirmado_at).toLocaleString('es-MX') : 'sin sello de hora'}</span></summary>
    <p className="muted epos-evidence__note">{evidencia.usuario_id == null ? 'Usuario de confirmación no identificado' : `Confirmado por usuario #${evidencia.usuario_id}`}</p>
    <div className="summary-grid epos-evidence__grid">
      <div><small>Epos</small><strong>{dinero(evidencia.epos.ventas)}</strong><span>Importe leído</span></div>
      <div><small>Confirmado</small><strong>{dinero(evidencia.confirmado.ventas)}</strong><span>Registro humano</span></div>
      <div><small>Diferencia</small><strong className={Math.abs(diferencia) > 0.01 ? 'text-danger' : ''}>{dinero(diferencia)}</strong><span>{Math.abs(diferencia) > 0.01 ? 'Revisar' : 'Cuadra'}</span></div>
      <div><small>Cuentas abiertas</small><strong>{evidencia.cuentas_abiertas}</strong><span>Al cierre del día</span></div>
    </div>
    <div className="epos-evidence__methods">
      <span><small>Epos · efectivo</small><strong>{dinero(evidencia.epos.efectivo)}</strong></span>
      <span><small>Epos · tarjeta</small><strong>{dinero(evidencia.epos.tarjeta)}</strong></span>
      <span><small>Epos · no clasificado</small><strong>{dinero(evidencia.epos.otros)}</strong></span>
      <span><small>Confirmado · efectivo</small><strong>{dinero(evidencia.confirmado.efectivo)}</strong></span>
      <span><small>Confirmado · tarjeta</small><strong>{dinero(evidencia.confirmado.tarjeta)}</strong></span>
      <span><small>Confirmado · no clasificado</small><strong>{dinero(evidencia.confirmado.otros)}</strong></span>
    </div>
    {evidencia.notas && <p className="muted epos-evidence__note">{evidencia.notas}</p>}
    {evidencia.excepciones.length > 0 && <p className="text-danger epos-evidence__note">{evidencia.excepciones.length} excepción(es) registrada(s) para revisión.</p>}
  </details>;
}

function DetalleVentasEpos({ filas, preview, metodoMixto }: { filas: EposVenta[]; preview: Map<number, CosteoVentaPreview>; metodoMixto: MetodoMixto | null }) {
  const porProducto = new Map<string, { cantidad: number; venta: number; costo: number; aplicadas: number; disponibles: number; pendientes: number; excepciones: number }>();
  const porMetodo = new Map<string, number>();
  filas.forEach((fila) => {
    const previo = porProducto.get(fila.producto) ?? { cantidad: 0, venta: 0, costo: 0, aplicadas: 0, disponibles: 0, pendientes: 0, excepciones: 0 };
    const vista = preview.get(fila.id);
    const aplicado = fila.costo_fifo != null || fila.costeo_estado === 'costeada';
    const disponible = !aplicado && vista?.estado === 'costeable';
    // La vista previa es la fuente actual de clasificación. Esto evita que
    // una excepción histórica (por ejemplo, una receta que ya fue validada)
    // siga apareciendo como excepción real.
    const esExcepcion = vista ? vista.estado === 'excepcion' : fila.costeo_estado === 'excepcion';
    const esPendiente = !aplicado && !disponible && !esExcepcion;
    const costo = fila.costo_fifo ?? (disponible ? vista?.costo_fifo ?? 0 : 0);
    porProducto.set(fila.producto, {
      cantidad: previo.cantidad + fila.cantidad,
      venta: previo.venta + (fila.venta_neta ?? fila.venta_bruta),
      costo: previo.costo + costo,
      aplicadas: previo.aplicadas + (aplicado ? 1 : 0),
      disponibles: previo.disponibles + (disponible ? 1 : 0),
      pendientes: previo.pendientes + (esPendiente ? 1 : 0),
      excepciones: previo.excepciones + (esExcepcion ? 1 : 0),
    });
    const metodoVisible = esMetodoMixtoEpos(fila.metodo_pago)
      ? (metodoMixto === 'cash' ? 'Efectivo' : metodoMixto === 'card' ? 'Tarjeta' : 'Card/Cash · clasificar')
      : fila.metodo_pago;
    porMetodo.set(metodoVisible, (porMetodo.get(metodoVisible) ?? 0) + (fila.venta_neta ?? fila.venta_bruta));
  });
  const productos = [...porProducto.entries()].sort((a, b) => b[1].venta - a[1].venta);
  if (!filas.length) return <div className="info-box info-box--compact"><strong>No hay ventas persistidas para este día.</strong><span className="muted">Importa Epos o revisa el rango de la semana.</span></div>;
  const productosDisponibles = productos.filter(([, dato]) => dato.disponibles > 0).length;
  const excepcionesReales = productos.filter(([, dato]) => dato.excepciones > 0).length;
  return <details className="ventas-detalle" open>
    <summary><strong>Detalle de ventas Epos</strong><span className="muted">{filas.length} líneas · {productos.length} productos</span></summary>
    <div className="ventas-detalle__summary">
      {[...porMetodo.entries()].map(([metodo, total]) => <span key={metodo}><small>{metodo}</small><strong>{mxn(total)}</strong></span>)}
    </div>
    {productosDisponibles > 0 && <div className="info-box info-box--compact"><strong>{productosDisponibles} producto(s) tienen costo FIFO disponible.</strong><span className="muted">El costo se puede aplicar desde Compras; esta vista previa no descuenta inventario.</span></div>}
    {excepcionesReales > 0 && <div className="info-box info-box--compact"><strong>{excepcionesReales} producto(s) tienen una excepción real.</strong><span className="muted">Sólo se muestran aquí productos sin mapeo Epos o con inventario FIFO insuficiente.</span></div>}
    <div className="ventas-detalle__table table-wrap"><table><thead><tr><th>Producto</th><th>Unidades</th><th>Venta</th><th>Costo FIFO</th><th>Estado</th></tr></thead><tbody>
      {productos.map(([producto, dato]) => <tr key={producto}><td><strong>{producto}</strong></td><td>{dato.cantidad}</td><td>{mxn(dato.venta)}</td><td>{dato.costo > 0 ? mxn(dato.costo) : '—'}</td><td><div className="ventas-detalle__statuses">
        {dato.aplicadas > 0 && <span className="status status--ok">Costo aplicado · {dato.aplicadas}</span>}
        {dato.disponibles > 0 && <span className="status status--info">Costo disponible · {dato.disponibles}</span>}
        {dato.excepciones > 0 && <span className="status status--danger">Excepción real · {dato.excepciones}</span>}
        {dato.pendientes > 0 && <span className="status status--warning">Pendiente de configuración · {dato.pendientes}</span>}
      </div></td></tr>)}
    </tbody></table></div>
  </details>;
}

function ResumenView({ r, semana, onCambio }: { r: Resumen; semana: Semana; onCambio: () => void }) {
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
      <ConciliacionInventarioCard conciliacion={r.conciliacion_inventario} />
      <CorreccionInventarioCard semana={semana} cierreId={r.inventario.cierre_snapshot_id} onSaved={onCambio} />
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

function ConciliacionInventarioCard({ conciliacion }: { conciliacion: Resumen['conciliacion_inventario'] }) {
  if (conciliacion.estado === 'pendiente_cierre') {
    return (
      <div className="resumen-card inventario-conciliacion">
        <strong>Conciliación FIFO vs. inventario físico</strong>
        <p className="muted">Se mostrará al cerrar la semana, después de capturar el inventario físico final.</p>
      </div>
    );
  }

  const filasConDiferencia = conciliacion.filas.filter((fila) => Math.abs(fila.diferencia_cantidad) > 0.01);
  return (
    <div className="resumen-card inventario-conciliacion">
      <div className="section-heading">
        <div>
          <strong>Conciliación FIFO vs. inventario físico</strong>
          <p className="muted">Apertura + compras + ajustes − consumo teórico frente al conteo final.</p>
        </div>
        <span className={`status ${conciliacion.productos_con_incidencia ? 'status--danger' : 'status--ok'}`}>
          {conciliacion.productos_con_incidencia ? `${conciliacion.productos_con_incidencia} incidencia(s)` : 'Sin diferencias'}
        </span>
      </div>
      <div className="summary-grid inventario-conciliacion__summary">
        <div><small>Productos revisados</small><strong>{conciliacion.filas.length}</strong></div>
        <div><small>Con diferencia</small><strong>{filasConDiferencia.length}</strong></div>
        <div><small>Diferencia valorizada</small><strong>{conciliacion.total_diferencia_valor == null ? 'Pendiente' : mxn(conciliacion.total_diferencia_valor)}</strong></div>
      </div>
      <details className="inventario-conciliacion__details">
        <summary>Ver detalle por producto</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Producto</th><th>Inicial</th><th>Compras</th><th>Ajuste</th><th>Consumo teórico</th><th>FIFO esperado</th><th>Físico final</th><th>Diferencia</th><th>Valor</th><th>Incidencia</th></tr></thead>
            <tbody>{conciliacion.filas.map((fila) => (
              <tr key={fila.product_id}>
                <td><strong>{fila.producto}</strong><small className="muted">{fila.unidad_base ?? 'unidad base pendiente'}</small></td>
                <td>{fila.inventario_inicial}</td>
                <td>{fila.compras_recibidas}</td>
                <td>{fila.ajustes_inventario}</td>
                <td>{fila.consumo_teorico}</td>
                <td>{fila.existencia_fifo_esperada}</td>
                <td>{fila.inventario_fisico_final}</td>
                <td className={Math.abs(fila.diferencia_cantidad) > 0.01 ? 'text-danger' : ''}>{fila.diferencia_cantidad}</td>
                <td>{fila.diferencia_valor == null ? '—' : mxn(fila.diferencia_valor)}</td>
                <td>{fila.incidencia}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted inventario-conciliacion__note">La incidencia es una hipótesis de revisión. Confirma si se trata de merma, error de captura, receta incorrecta o compra faltante antes de ajustar el inventario.</p>
      </details>
    </div>
  );
}

function CorreccionInventarioCard({ semana, cierreId, onSaved }: { semana: Semana; cierreId: number | null; onSaved: () => void }) {
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof finanzas.correccionesReferencias>> | null>(null);
  const [correcciones, setCorrecciones] = useState<Awaited<ReturnType<typeof finanzas.correcciones>>>([]);
  const [productoId, setProductoId] = useState('');
  const [zonaId, setZonaId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const { error } = useToast();
  const producto = refs?.productos.find((p) => String(p.id) === productoId);
  const zona = producto?.unidades.find((u) => String(u.zona_id) === zonaId);
  const puedeCorregir = cierreId != null && productoId && zonaId && Number(cantidad) !== 0 && motivo.trim().length >= 5;

  async function cargar() {
    try {
      const [r, c] = await Promise.all([finanzas.correccionesReferencias(semana.id), finanzas.correcciones(semana.id)]);
      setRefs(r); setCorrecciones(c);
      if (!zonaId && r.zonas[0]) setZonaId(String(r.zonas[0].id));
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudieron cargar las referencias'); }
  }
  useEffect(() => { void cargar(); }, [semana.id]);

  async function guardar() {
    if (!puedeCorregir || !zona) return;
    setGuardando(true);
    try {
      await finanzas.crearCorreccion(semana.id, {
        product_id: Number(productoId), zona_id: Number(zonaId), cantidad_base: Number(cantidad) * zona.factor,
        motivo, nota: nota || null, solicitud_id: crypto.randomUUID(),
      });
      setCantidad(''); setMotivo(''); setNota(''); await cargar(); onSaved();
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo guardar la corrección'); }
    finally { setGuardando(false); }
  }

  return <div className="resumen-card inventario-correccion">
    <div className="section-heading"><div><strong>Corrección de inventario</strong><p className="muted">Ajusta una semana cerrada sin editar su snapshot histórico. El cambio queda auditado y se encadena a la siguiente apertura.</p></div><span className="chip chip--info">FIFO + físico</span></div>
    {!cierreId ? <p className="muted">Captura y cierra el inventario físico antes de corregir esta semana.</p> : <>
      <div className="form-grid form-grid--four">
        <label>Producto<select value={productoId} onChange={(e) => { setProductoId(e.target.value); setZonaId(''); }}><option value="">Selecciona…</option>{refs?.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <label>Zona<select value={zonaId} onChange={(e) => setZonaId(e.target.value)} disabled={!producto}><option value="">Selecciona…</option>{producto?.unidades.map((u) => <option key={u.zona_id} value={u.zona_id}>{refs?.zonas.find((z) => z.id === u.zona_id)?.nombre} · {u.unidad_captura} × {u.factor}</option>)}</select></label>
        <label>Cantidad (+/−)<input type="number" step="any" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej. 2" />{zona && <small className="muted">{zona.unidad_captura} · {Number(cantidad || 0) * zona.factor} {producto?.unidad_base ?? 'base'}</small>}</label>
        <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. 2 cajas omitidas" /></label>
      </div>
      <label>Nota de evidencia (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué se verificó y quién lo confirmó" /></label>
      <button className="btn-primary" style={{ marginTop: '0.75rem' }} disabled={!puedeCorregir || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Aplicar corrección segura'}</button>
      {correcciones.length > 0 && <details className="inventario-conciliacion__details" style={{ marginTop: '1rem' }}><summary>Historial de correcciones ({correcciones.length})</summary><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Zona</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody>{correcciones.map((c) => <tr key={c.id}><td>{c.producto}</td><td>{c.zona}</td><td className={c.cantidad_base < 0 ? 'text-danger' : ''}>{c.cantidad_captura} {c.unidad_captura} ({c.cantidad_base} base)</td><td>{c.motivo}{c.nota ? <small className="muted">{c.nota}</small> : null}</td><td>{c.usuario}</td></tr>)}</tbody></table></div></details>}
    </>}
  </div>;
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
  const etiquetaMovimiento = (m: Movimiento) => {
    if (m.tipo === 'compra_inventario') return 'Compra de inventario';
    if (m.tipo === 'gasto' && m.compra_id != null) return 'Gasto operativo · ticket vinculado';
    return TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo;
  };
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
        <strong>Compras</strong>
        <p className="muted">Captura cada compra una sola vez. Al confirmarla se crea el lote FIFO y el movimiento financiero; el historial de operaciones se consulta abajo.</p>
      </section>
      {semana.estado === 'abierta' && <details className="operation-adjustment">
        <summary><strong>Añadir ajuste manual</strong><span className="muted">Solo para correcciones, transferencias o movimientos que no provienen de un ticket</span></summary>
        <FormMovimiento ref_={ref_} semana={semana} onSaved={onChange} />
      </details>}
      {movs.length > 0 && (
        <button className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={exportar}>Exportar registro</button>
      )}
      <RegistroComprasPanel semana={semana} onChange={onChange} />
      <h3 className="section-title" style={{ marginTop: '1.25rem' }}>Historial de operaciones</h3>
      <ul className="conteo-list" style={{ marginTop: '1rem' }}>
        {movs.length === 0 && <li className="muted" style={{ padding: '1rem' }}>Sin operaciones registradas aún.</li>}
        {movs.map((m) => (
          <li key={m.id} className="conteo-row operation-row">
            {editando === m.id ? <div className="conteo-info operation-row__editor" style={{ display: 'grid', gap: '0.4rem' }}>
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
            </div> : <><div className="conteo-info operation-row__info">
              <strong>{etiquetaMovimiento(m)}</strong>
              <small className="muted">
                {[nombreUbic(m.ubicacion_origen_id), nombreUbic(m.ubicacion_destino_id)].filter(Boolean).join(' → ')}
                {m.descripcion ? ` · ${m.descripcion}` : ''}{m.facturado ? ' · facturado' : ''}
              </small>
            </div><span className="operation-row__amount">{mxn(m.monto)}</span></>}
            <div className="operation-row__actions">
            {semana.estado === 'abierta' && (
              <>{editando !== m.id && (m.compra_id != null ? <button className="btn-ghost" title="Editar compra y movimiento vinculado" onClick={() => setCompraEditando(m.compra_id!)}>Editar compra</button> : <button className="btn-ghost" title="Editar movimiento" onClick={() => { setEditando(m.id); setMontoEdit(String(m.monto)); setOrigenEdit(m.ubicacion_origen_id ?? ''); setDestinoEdit(m.ubicacion_destino_id ?? ''); setCategoriaEdit(m.categoria_id ?? ''); setErrorEdit(''); }}>Editar</button>)}{m.compra_id == null && <button
                className="icon-btn" title="Borrar movimiento" aria-label="Borrar movimiento"
                onClick={async () => { const ok = await confirmar({ message: '¿Borrar este movimiento? Afecta el cuadre de la semana.', tone: 'danger', confirmText: 'Borrar' }); if (!ok) return; try { await finanzas.borrarMovimiento(m.id); onChange(); } catch (e) { setErrorEdit(e instanceof Error ? e.message : 'No se pudo borrar'); } }}
              >✕</button>}</>
            )}
            </div>
          </li>
        ))}
      </ul>
      {compraEditando != null && <CompraEditorV2 compraId={compraEditando} ref_={ref_} onClose={() => setCompraEditando(null)} onSaved={() => { setCompraEditando(null); onChange(); }} />}
    </>
  );
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
    const numerico = campo === 'cantidad_fuente' || campo === 'cantidad_base' || campo === 'contenido_compra' || campo === 'importe' || campo === 'costo_unitario';
    setLineas((v) => v.map((l, idx) => {
      if (idx !== i) return l;
      const siguiente = { ...l, [campo]: numerico ? (valor === '' ? null : Number(valor)) : valor };
      if (campo === 'cantidad_fuente' || campo === 'unidad_fuente' || campo === 'unidad_compra' || campo === 'contenido_compra') {
        const producto = productos.find((p) => p.id === siguiente.product_id);
        const base = cantidadBaseDesdePresentacion({ cantidadCompra: Number(siguiente.cantidad_fuente), unidadCompra: siguiente.unidad_fuente || siguiente.unidad_compra, contenidoPorPresentacion: Number(siguiente.contenido_compra ?? producto?.contenido_compra), unidadBase: producto?.unidad_base, rendimientoUtil: producto?.rendimiento_util });
        if (base != null) siguiente.cantidad_base = base;
      }
      return siguiente;
    }));
  }

  function seleccionarProducto(i: number, valor: string) {
    const productId = valor ? Number(valor) : null;
    const producto = productos.find((p) => p.id === productId);
    setLineas((v) => v.map((l, idx) => {
      if (idx !== i) return l;
      const siguiente = {
        ...l,
        product_id: productId,
        producto: producto?.nombre ?? null,
        unidad_compra: producto?.unidad_compra ?? l.unidad_compra,
        unidad_fuente: producto?.unidad_compra ?? l.unidad_fuente,
        contenido_compra: producto?.contenido_compra ?? l.contenido_compra,
        descripcion_fuente: l.descripcion_fuente || producto?.nombre || '',
      };
      const base = cantidadBaseDesdePresentacion({
        cantidadCompra: Number(siguiente.cantidad_fuente),
        unidadCompra: siguiente.unidad_fuente || siguiente.unidad_compra,
        contenidoPorPresentacion: Number(siguiente.contenido_compra ?? producto?.contenido_compra),
        unidadBase: producto?.unidad_base,
        rendimientoUtil: producto?.rendimiento_util,
      });
      if (base != null) siguiente.cantidad_base = base;
      return siguiente;
    }));
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
      <div className="quick-lines">{lineas.map((l, i) => { const producto = productos.find((p) => p.id === l.product_id); const cantidadCalculada = cantidadBaseDesdePresentacion({ cantidadCompra: Number(l.cantidad_fuente), unidadCompra: l.unidad_fuente || l.unidad_compra, contenidoPorPresentacion: Number(l.contenido_compra ?? producto?.contenido_compra), unidadBase: producto?.unidad_base, rendimientoUtil: producto?.rendimiento_util }); const costoCalculado = costoBase(Number(l.importe), cantidadCalculada ?? Number(l.cantidad_base)); return <div className="quick-line" key={l.id ?? `${compra.id}-${i}`}>
        <div className="quick-line__head"><strong>Línea {i + 1}{l.producto ? ` · ${l.producto}` : ''}</strong><button className="btn-ghost" onClick={() => setLineas((v) => v.filter((_, idx) => idx !== i))} disabled={lineas.length === 1}>Quitar</button></div>
        <input value={l.descripcion_fuente} placeholder="Descripción de la fuente" onChange={(e) => editar(i, 'descripcion_fuente', e.target.value)} aria-label={`Descripción línea ${i + 1}`} />
        <select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value)}><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option><option value="pendiente">Pendiente</option></select>
        {l.tipo_linea === 'inventario' && <><select value={l.product_id ?? ''} onChange={(e) => seleccionarProducto(i, e.target.value)}><option value="">Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {presentacionCompra(p)}</option>)}</select>{producto && <small className="quick-line__presentation">{presentacionTexto(producto)}. El contenido está expresado en {producto.unidad_base ?? 'unidad base'}.</small>}<div className="fifo-entry-help">Captura la presentación comprada, no el total base. Ejemplo: <strong>2 piezas × 500 g = 1,000 g</strong>.</div><div className="quick-line__numbers fifo-entry-fields"><label>Cantidad comprada<input type="number" min="0" step="any" value={l.cantidad_fuente ?? ''} placeholder="Ej. 2" onChange={(e) => editar(i, 'cantidad_fuente', e.target.value)} aria-label={`Cantidad comprada línea ${i + 1}`} /></label><label>Unidad de compra<input value={l.unidad_fuente ?? l.unidad_compra ?? ''} placeholder="pz, caja, botella…" onChange={(e) => editar(i, 'unidad_fuente', e.target.value)} aria-label={`Unidad de compra línea ${i + 1}`} /></label><label>Contenido por unidad ({producto?.unidad_base ?? 'unidad base'})<input type="number" min="0" step="any" value={l.contenido_compra ?? producto?.contenido_compra ?? ''} placeholder="Ej. 500" onChange={(e) => editar(i, 'contenido_compra', e.target.value)} aria-label={`Contenido por unidad línea ${i + 1}`} /></label><label>Total base {cantidadCalculada != null && <small>(calculado)</small>}<input type="number" min="0" step="any" value={cantidadCalculada ?? l.cantidad_base ?? ''} readOnly={cantidadCalculada != null} placeholder="Captura si no hay presentación" onChange={(e) => editar(i, 'cantidad_base', e.target.value)} aria-label={`Total base línea ${i + 1}`} /></label><label>Importe del ticket<input type="number" min="0" step="0.01" value={l.importe} placeholder="Ej. 146" onChange={(e) => editar(i, 'importe', e.target.value)} aria-label={`Importe línea ${i + 1}`} /></label></div>{cantidadCalculada != null && <small className="fifo-entry-result">FIFO registrará {formatoCantidad(cantidadCalculada)} {producto?.unidad_base ?? 'unidades base'} · costo base {costoCalculado == null ? '—' : mxn(costoCalculado)}</small>}</>}
        {l.tipo_linea === 'gasto' && <label className="fifo-expense-amount">Importe del gasto<input type="number" min="0" step="0.01" value={l.importe} placeholder="Ej. 146" onChange={(e) => editar(i, 'importe', e.target.value)} /></label>}
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
