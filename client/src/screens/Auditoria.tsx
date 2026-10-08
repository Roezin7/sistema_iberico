import { useEffect, useState } from 'react';
import { api } from '../api';
import { Cargando } from '../ui/Cargando';

type Evento = { id: number; entidad: string; entidad_id: string | null; accion: string; usuario: string | null; creado_at: string; antes: unknown; despues: unknown };

export default function Auditoria() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api<Evento[]>('/finanzas/auditoria?limit=200').then(setEventos).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar la auditoría')).finally(() => setCargando(false)); }, []);
  return <div className="page">
    <header className="page-head"><div><span className="eyebrow">Control y trazabilidad</span><h1>Auditoría</h1><p className="page-sub">Cambios operativos registrados por usuario y fecha.</p></div></header>
    {error && <div className="operation-error" role="alert">{error}</div>}
    {cargando ? <section className="card"><Cargando etiqueta="Cargando eventos…" /></section> : <section className="card">
      {!eventos.length ? <p className="muted">Aún no hay eventos registrados.</p> : <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Entidad</th><th>Acción</th><th>Usuario</th><th>Detalle</th></tr></thead><tbody>{eventos.map((e) => <tr key={e.id}><td>{new Date(e.creado_at).toLocaleString('es-MX')}</td><td>{e.entidad}{e.entidad_id ? ` #${e.entidad_id}` : ''}</td><td>{e.accion}</td><td>{e.usuario ?? 'Sistema'}</td><td><code>{JSON.stringify(e.despues ?? {})}</code></td></tr>)}</tbody></table></div>}
    </section>}
  </div>;
}
