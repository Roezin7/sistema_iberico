import { useEffect, useState } from 'react';
import {
  finanzas, mxn, TIPOS, type Referencias, type Semana, type Resumen, type FilaCuadre,
  type Movimiento, type TipoMov, type DiaFila,
} from './api';
import { Icono } from '../../icons';
import { descargarCSV } from '../../csv';

export default function Finanzas() {
  const [ref, setRef] = useState<Referencias | null>(null);
  const [saldosFijados, setSaldosFijados] = useState<boolean | null>(null);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semanaId, setSemanaId] = useState<number | null>(null);

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

  if (!ref || saldosFijados == null) return <Marco><p className="muted">Cargando…</p></Marco>;
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
        <button className="pill" onClick={async () => { await finanzas.crearSemana(); recargar(); }}>+ Semana</button>
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
          <h1>Finanzas</h1>
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

  async function cargar() {
    const [r, m, c, d] = await Promise.all([
      finanzas.resumen(semana.id), finanzas.movimientos(semana.id), finanzas.cuadre(semana.id), finanzas.dias(semana.id),
    ]);
    setResumen(r); setMovs(m); setCuadre(c.ubicaciones); setDias(d.dias);
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
              if (!confirm('¿Reabrir la semana para editarla? Se quitarán la comisión de terminal y el snapshot de patrimonio de esta semana; se regeneran al volver a cerrar.')) return;
              try { await finanzas.reabrir(semana.id); onCambio(); cargar(); }
              catch (e) { alert(e instanceof Error ? e.message : 'No se pudo reabrir'); }
            }}>Reabrir</button>
          )}
        </span>
      </div>
      <nav className="tabs">
        <button className={tab === 'dia' ? 'tab tab--on' : 'tab'} onClick={() => setTab('dia')}>Por día</button>
        <button className={tab === 'resumen' ? 'tab tab--on' : 'tab'} onClick={() => setTab('resumen')}>Resumen</button>
        <button className={tab === 'movs' ? 'tab tab--on' : 'tab'} onClick={() => setTab('movs')}>Otros mov.</button>
        <button className={tab === 'cuadre' ? 'tab tab--on' : 'tab'} onClick={() => setTab('cuadre')}>Cuadre</button>
      </nav>

      {tab === 'dia' && <DiaView semana={semana} dias={dias} onChange={cargar} />}
      {tab === 'resumen' && resumen && <ResumenView r={resumen} />}
      {tab === 'movs' && (
        <MovimientosView ref_={ref_} semana={semana} movs={movs} onChange={cargar} />
      )}
      {tab === 'cuadre' && (
        <CuadreView ref_={ref_} semana={semana} filas={cuadre} onChange={cargar} />
      )}

      {abierta && (tab === 'resumen' || tab === 'cuadre') && (
        <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={async () => {
          if (!confirm('¿Cerrar la semana? Se generará la comisión de terminal y se congelarán los saldos.')) return;
          await finanzas.cerrar(semana.id); onCambio(); cargar();
        }}>Cerrar semana</button>
      )}
    </>
  );
}

function DiaView({ semana, dias, onChange }: { semana: Semana; dias: DiaFila[]; onChange: () => void }) {
  const abierta = semana.estado === 'abierta';
  const maxVenta = Math.max(1, ...dias.map((d) => d.total_ventas));
  const totalSemana = dias.reduce((a, d) => a + d.total_ventas, 0);

  return (
    <>
      <div className="resumen-card">
        <span className="muted">Ventas de la semana</span>
        <strong className="big-number">{mxn(totalSemana)}</strong>
      </div>

      {/* Mini-gráfica de barras por día */}
      <div className="dia-chart">
        {dias.map((d) => (
          <div key={d.fecha} className="dia-bar-wrap" title={`${d.dia} ${mxn(d.total_ventas)}`}>
            <div className="dia-bar" style={{ height: `${(d.total_ventas / maxVenta) * 100}%` }} />
            <small className="muted">{d.dia}</small>
          </div>
        ))}
      </div>

      {dias.map((d) => (
        <DiaCard key={d.fecha} semana={semana} dia={d} abierta={abierta} onSaved={onChange} />
      ))}
    </>
  );
}

function DiaCard({ semana, dia, abierta, onSaved }: { semana: Semana; dia: DiaFila; abierta: boolean; onSaved: () => void }) {
  const [efectivo, setEfectivo] = useState(String(dia.venta_efectivo || ''));
  const [tarjeta, setTarjeta] = useState(String(dia.venta_tarjeta || ''));
  const [propina, setPropina] = useState(String(dia.propina_tarjeta || ''));
  const [gasto, setGasto] = useState(String(dia.gasto_efectivo || ''));
  const [sueldos, setSueldos] = useState(String(dia.sueldos || ''));
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);

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

  const campo = (emoji: string, label: string, val: string, set: (v: string) => void) => (
    <label>{emoji} {label}<input type="number" inputMode="decimal" value={val} disabled={!abierta} onChange={(e) => set(e.target.value)} placeholder="0" /></label>
  );

  return (
    <div className="dia-card">
      <div className="dia-card__head">
        <strong>{dia.dia} <span className="muted">{dia.fecha.slice(5)}</span></strong>
        <span className="muted">ventas {mxn(ventas)}{egresos ? ` · egresos ${mxn(egresos)}` : ''}</span>
      </div>
      <div className="dia-section muted">Ventas</div>
      <div className="dia-inputs">
        {campo('💵', 'Efectivo', efectivo, setEfectivo)}
        {campo('💳', 'Tarjeta', tarjeta, setTarjeta)}
        {campo('🎁', 'Propina', propina, setPropina)}
      </div>
      <div className="dia-section muted">Egresos (efectivo)</div>
      <div className="dia-inputs dia-inputs--2">
        {campo('🧾', 'Gastos', gasto, setGasto)}
        {campo('👷', 'Sueldos', sueldos, setSueldos)}
      </div>
      {abierta && (
        <button className="btn-primary dia-save" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar día'}
        </button>
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
        <div className="kpi">
          <div className="kpi__label">Utilidad</div>
          <div className="kpi__value">{mxn(r.utilidad)}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Margen</div>
          <div className="kpi__value">{(r.margen * 100).toFixed(1)}%</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Utilidad %</div>
          <div className="kpi__value">{(r.utilidad_pct * 100).toFixed(0)}%</div>
        </div>
        <div className="kpi">
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
            <div className="conteo-info">
              <strong>{TIPOS.find((t) => t.tipo === m.tipo)?.label ?? m.tipo}</strong>
              <small className="muted">
                {[nombreUbic(m.ubicacion_origen_id), nombreUbic(m.ubicacion_destino_id)].filter(Boolean).join(' → ')}
                {m.descripcion ? ` · ${m.descripcion}` : ''}{m.facturado ? ' · facturado' : ''}
              </small>
            </div>
            <span>{mxn(m.monto)}</span>
            {semana.estado === 'abierta' && (
              <button
                className="icon-btn"
                title="Borrar movimiento"
                aria-label="Borrar movimiento"
                onClick={async () => {
                  if (!confirm('¿Borrar este movimiento? Afecta el cuadre de la semana.')) return;
                  await finanzas.borrarMovimiento(m.id);
                  onChange();
                }}
              >
                ✕
              </button>
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
