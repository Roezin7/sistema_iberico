import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';
import { descargarCSV } from '../../csv';

interface Snapshot {
  id: number; fecha: string; total_banco: number; total_efectivo: number;
  total_inventario: number; total_pasivos: number; patrimonio_neto: number;
}
interface Pasivo { id: number; nombre: string; monto: number; tipo: string | null; activo: boolean }

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function Patrimonio() {
  const [tab, setTab] = useState<'tendencia' | 'pasivos'>('tendencia');
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="trending" size={24} className="ttl-icon" />
          <h1>Patrimonio</h1>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'tendencia' ? 'tab tab--on' : 'tab'} onClick={() => setTab('tendencia')}>Tendencia</button>
        <button className={tab === 'pasivos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('pasivos')}>Pasivos</button>
      </nav>
      <div className="tab-body">{tab === 'tendencia' ? <Tendencia /> : <Pasivos />}</div>
    </div>
  );
}

function Tendencia() {
  const [data, setData] = useState<{ serie: Snapshot[]; ultimo: Snapshot | null } | null>(null);
  useEffect(() => { api<{ serie: Snapshot[]; ultimo: Snapshot | null }>('/patrimonio/tendencia').then(setData); }, []);
  if (!data) return <p className="muted">Cargando…</p>;
  if (!data.ultimo) return <p className="muted">Aún no hay snapshots. Se generan automáticamente al cerrar cada semana.</p>;
  const u = data.ultimo;
  const fila = (l: string, v: number, color?: string) => (
    <div className="kv">
      <span className="muted" style={color ? { display: 'flex', alignItems: 'center', gap: '0.4rem' } : undefined}>
        {color && <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />}
        {l}
      </span>
      <span>{mxn(v)}</span>
    </div>
  );
  return (
    <>
      <div className="resumen-card">
        <span className="muted">Patrimonio neto actual</span>
        <strong className="big-number">{mxn(u.patrimonio_neto)}</strong>
        <small className="muted">al {u.fecha}</small>
      </div>
      <Sparkline serie={data.serie} />
      <ComponentesBar u={u} />
      <div className="resumen-card">
        {fila('Banco', u.total_banco, 'var(--data-azulejo)')}
        {fila('Efectivo (caja + cajas fuertes)', u.total_efectivo, 'var(--data-olivo)')}
        {fila('Inventario (a costo)', u.total_inventario, 'var(--data-ochre)')}
        {fila('Pasivos', -u.total_pasivos, 'var(--data-vino)')}
      </div>
      <div className="resumen-card">
        <div className="card-head">
          <strong>Historial</strong>
          <button className="btn-secondary" onClick={() => descargarCSV(
            'patrimonio',
            ['Fecha', 'Banco', 'Efectivo', 'Inventario', 'Pasivos', 'Patrimonio neto'],
            data.serie.map((s) => [s.fecha, s.total_banco, s.total_efectivo, s.total_inventario, s.total_pasivos, s.patrimonio_neto]),
          )}>Exportar CSV</button>
        </div>
        {[...data.serie].reverse().map((s) => (
          <div key={s.id} className="kv"><span className="muted">{s.fecha}</span><span>{mxn(s.patrimonio_neto)}</span></div>
        ))}
      </div>
    </>
  );
}

function Sparkline({ serie }: { serie: Snapshot[] }) {
  if (serie.length < 2) return null;
  const W = 320, Hh = 90, pad = 8;
  const vals = serie.map((s) => s.patrimonio_neto);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xy = serie.map((s, i) => {
    const x = pad + (i * (W - 2 * pad)) / (serie.length - 1);
    const y = Hh - pad - ((s.patrimonio_neto - min) / span) * (Hh - 2 * pad);
    return [x, y] as const;
  });
  const linea = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${Hh - pad} ${linea} ${(W - pad).toFixed(1)},${Hh - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="sparkline" preserveAspectRatio="none">
      <polygon points={area} fill="var(--data-vino)" opacity="0.1" />
      <polyline points={linea} fill="none" stroke="var(--data-vino)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// Barra apilada de componentes del patrimonio (activos), con la paleta de datos.
function ComponentesBar({ u }: { u: Snapshot }) {
  const partes = [
    { l: 'Banco', v: Math.max(0, u.total_banco), c: 'var(--data-azulejo)' },
    { l: 'Efectivo', v: Math.max(0, u.total_efectivo), c: 'var(--data-olivo)' },
    { l: 'Inventario', v: Math.max(0, u.total_inventario), c: 'var(--data-ochre)' },
  ];
  const total = partes.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', marginBottom: '1rem' }}>
      {partes.map((p) => (
        <div key={p.l} title={`${p.l}`} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} />
      ))}
    </div>
  );
}

function Pasivos() {
  const [pasivos, setPasivos] = useState<Pasivo[]>([]);
  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const cargar = () => api<Pasivo[]>('/patrimonio/pasivos').then(setPasivos);
  useEffect(() => { void cargar(); }, []);

  return (
    <>
      <div className="form-mov">
        <strong>Agregar pasivo</strong>
        <input placeholder="Nombre (ej. Préstamo equipo)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <input type="number" inputMode="decimal" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
        <button className="btn-primary" onClick={async () => {
          if (!nombre || !monto) return;
          await api('/patrimonio/pasivos', { method: 'POST', body: { nombre, monto: Number(monto) } });
          setNombre(''); setMonto(''); cargar();
        }}>Agregar</button>
      </div>
      <ul className="conteo-list" style={{ marginTop: '1rem' }}>
        {pasivos.length === 0 && <li className="muted" style={{ padding: '1rem' }}>Sin pasivos registrados.</li>}
        {pasivos.map((p) => (
          <li key={p.id} className="conteo-row" style={{ opacity: p.activo ? 1 : 0.5 }}>
            <div className="conteo-info"><strong>{p.nombre}</strong><small className="muted">{p.activo ? 'activo' : 'inactivo'}</small></div>
            <span>{mxn(p.monto)}</span>
            <button className="pill" onClick={async () => {
              await api(`/patrimonio/pasivos/${p.id}`, { method: 'PATCH', body: { activo: !p.activo } });
              cargar();
            }}>{p.activo ? 'Saldar' : 'Reactivar'}</button>
          </li>
        ))}
      </ul>
    </>
  );
}
