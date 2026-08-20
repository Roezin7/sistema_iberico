import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Icono } from '../../icons';
import { Cargando } from '../../ui/Cargando';

interface ItemDia { id: number; texto: string; orden: number; completado: boolean }
interface ChecklistDia {
  checklist_id: number; instancia_id: number; nombre: string; tipo: 'apertura' | 'cierre';
  items: ItemDia[]; progreso: { hechos: number; total: number };
}
interface Dia { fecha: string; checklists: ChecklistDia[] }
interface ChecklistAdmin {
  id: number; nombre: string; tipo: 'apertura' | 'cierre'; activo: boolean;
  items: { id: number; texto: string; orden: number }[];
}

const hoyMx = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

export default function Tareas() {
  const { usuario } = useAuth();
  const [tab, setTab] = useState<'hoy' | 'gestionar'>('hoy');
  const esAdmin = usuario?.rol === 'admin';

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="checks" size={24} className="ttl-icon" />
          <h1>Tareas</h1>
        </div>
      </header>
      {esAdmin && (
        <nav className="tabs">
          <button className={tab === 'hoy' ? 'tab tab--on' : 'tab'} onClick={() => setTab('hoy')}>Hoy</button>
          <button className={tab === 'gestionar' ? 'tab tab--on' : 'tab'} onClick={() => setTab('gestionar')}>Gestionar</button>
        </nav>
      )}
      <div className="tab-body">{tab === 'hoy' || !esAdmin ? <Hoy /> : <Gestionar />}</div>
    </div>
  );
}

function Hoy() {
  const [fecha, setFecha] = useState(hoyMx());
  const [dia, setDia] = useState<Dia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const esDiaOperativo = (f: string) => {
    const weekday = new Date(`${f}T12:00:00`).getDay();
    return weekday === 0 || weekday === 5 || weekday === 6;
  };
  const cargar = async (f: string) => {
    setCargando(true); setError('');
    if (!esDiaOperativo(f)) {
      setDia({ fecha: f, checklists: [] });
      setCargando(false);
      return;
    }
    try {
      setDia(await api<Dia>(`/tareas/dia?fecha=${f}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las tareas');
      setDia(null);
    } finally { setCargando(false); }
  };
  useEffect(() => { void cargar(fecha); }, [fecha]);

  async function toggle(instancia_id: number, item: ItemDia) {
    setError('');
    // Optimista
    setDia((d) => d && {
      ...d,
      checklists: d.checklists.map((c) =>
        c.instancia_id !== instancia_id ? c : {
          ...c,
          items: c.items.map((i) => (i.id === item.id ? { ...i, completado: !i.completado } : i)),
          progreso: { ...c.progreso, hechos: c.progreso.hechos + (item.completado ? -1 : 1) },
        }),
    });
    try {
      await api('/tareas/resultados', { method: 'PATCH', body: { instancia_id, item_id: item.id, completado: !item.completado } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la tarea');
      void cargar(fecha);
    }
  }

  if (cargando && !dia) return <Cargando etiqueta="Cargando tareas…" />;
  if (error && !dia) return (
    <div className="empty-state empty-state--error">
      <strong>No se pudieron cargar las tareas</strong>
      <p>{error}</p>
      <button className="pill" onClick={() => void cargar(fecha)}>Reintentar</button>
    </div>
  );
  if (!dia) return null;
  const esOperativo = esDiaOperativo(fecha);
  return (
    <>
      <input className="buscador" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      {error && <div className="empty-state empty-state--error" style={{ marginTop: '0.75rem' }}><strong>No se pudo guardar el último cambio</strong><p>{error}</p><button className="pill" onClick={() => void cargar(fecha)}>Reintentar</button></div>}
      {!esOperativo && <div className="aviso aviso--info">No hay operación del bar este día. Las tareas de apertura y cierre se muestran de viernes a domingo.</div>}
      {dia.checklists.length === 0 && <p className="muted">{esOperativo ? 'No hay checklists activos. Pídele a un admin que los configure.' : 'No hay tareas operativas para este día.'}</p>}
      {dia.checklists.map((c) => {
        const completo = c.progreso.hechos === c.progreso.total && c.progreso.total > 0;
        return (
          <div key={c.checklist_id} className="resumen-card" style={{ gap: '0.4rem' }}>
            <div className="kv">
              <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Icono name={c.tipo === 'apertura' ? 'sunrise' : 'moon'} size={17} className="ttl-icon" /> {c.nombre}
              </strong>
              <span className={completo ? 'badge-ok' : 'muted'}>{c.progreso.hechos}/{c.progreso.total}{completo ? ' ✓' : ''}</span>
            </div>
            {c.items.map((it) => (
              <button key={it.id} className={`task-row ${it.completado ? 'task-row--done' : ''}`} onClick={() => toggle(c.instancia_id, it)}>
                <span className="checkbox">{it.completado ? '✓' : ''}</span>
                <span>{it.texto}</span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Gestionar() {
  const [cls, setCls] = useState<ChecklistAdmin[]>([]);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'apertura' | 'cierre'>('apertura');
  const cargar = () => api<ChecklistAdmin[]>('/tareas/checklists').then(setCls);
  useEffect(() => { void cargar(); }, []);

  return (
    <>
      <div className="form-mov">
        <strong>Nuevo checklist</strong>
        <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as 'apertura' | 'cierre')}>
          <option value="apertura">Apertura</option>
          <option value="cierre">Cierre</option>
        </select>
        <button className="btn-primary" onClick={async () => {
          if (!nombre) return;
          await api('/tareas/checklists', { method: 'POST', body: { nombre, tipo } });
          setNombre(''); cargar();
        }}>Crear</button>
      </div>
      {cls.map((c) => <ChecklistEditor key={c.id} c={c} onChange={cargar} />)}
    </>
  );
}

function ChecklistEditor({ c, onChange }: { c: ChecklistAdmin; onChange: () => void }) {
  const [nuevo, setNuevo] = useState('');
  return (
    <div className="resumen-card" style={{ gap: '0.3rem', opacity: c.activo ? 1 : 0.55 }}>
      <div className="kv">
        <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Icono name={c.tipo === 'apertura' ? 'sunrise' : 'moon'} size={17} className="ttl-icon" /> {c.nombre}
        </strong>
        <button className="pill" onClick={async () => {
          await api(`/tareas/checklists/${c.id}`, { method: 'PATCH', body: { activo: !c.activo } }); onChange();
        }}>{c.activo ? 'Desactivar' : 'Activar'}</button>
      </div>
      {c.items.map((it) => (
        <div key={it.id} className="conteo-row" style={{ padding: '0.3rem 0' }}>
          <span>{it.texto}</span>
          <button className="link-btn" aria-label={`Eliminar ítem ${it.texto}`} onClick={async () => { await api(`/tareas/items/${it.id}`, { method: 'DELETE' }); onChange(); }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <input style={{ flex: 1 }} placeholder="Nuevo ítem…" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button className="pill" onClick={async () => {
          if (!nuevo) return;
          await api(`/tareas/checklists/${c.id}/items`, { method: 'POST', body: { texto: nuevo, orden: c.items.length + 1 } });
          setNuevo(''); onChange();
        }}>+ Ítem</button>
      </div>
    </div>
  );
}
