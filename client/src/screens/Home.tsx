import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { api } from '../api';

interface Modulo {
  clave: string;
  titulo: string;
  icono: Parameters<typeof Icono>[0]['name'];
  desc: string;
  ruta?: string; // si no hay ruta -> aún no disponible
  soloAdmin?: boolean;
}

const MODULOS: Modulo[] = [
  { clave: 'inventario', titulo: 'Inventario', icono: 'package', desc: 'Conteos y lista de compras', ruta: '/inventario' },
  { clave: 'finanzas', titulo: 'Cierre y caja', icono: 'wallet', desc: 'Cortes diarios, pagos y cuadre', ruta: '/finanzas', soloAdmin: true },
  { clave: 'patrimonio', titulo: 'Patrimonio', icono: 'trending', desc: 'Tendencia y snapshots', ruta: '/patrimonio', soloAdmin: true },
  { clave: 'ajustes', titulo: 'Catálogo y ajustes', icono: 'settings', desc: 'Productos, mínimos, saldos', ruta: '/configuracion', soloAdmin: true },
];

function saludo() {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Mexico_City' }));
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Home() {
  const { usuario } = useAuth();
  const [semana, setSemana] = useState<{ etiqueta: string; estado: string } | null>(null);
  useEffect(() => {
    if (!usuario || usuario.rol !== 'admin') return;
    api<{ etiqueta: string; estado: string }>('/finanzas/semanas/actual')
      .then(setSemana)
      .catch(() => setSemana(null));
  }, [usuario]);

  if (!usuario) return null;

  const visibles = MODULOS.filter((m) => !m.soloAdmin || usuario.rol === 'admin');
  const hoy = new Date();
  const dia = hoy.getDay();
  const operativo = dia === 0 || dia === 5 || dia === 6;
  const estadoHoy = operativo ? 'Día operativo' : 'Sin operación del bar';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{saludo()}, {usuario.nombre}</h1>
          <p className="page-sub">Centro de operación de Ibérico</p>
        </div>
      </header>

      <section className={`operating-brief ${operativo ? 'operating-brief--on' : ''}`}>
        <div>
          <span className="eyebrow">Hoy</span>
          <h2>{estadoHoy}</h2>
          <p className="muted">
            {operativo
              ? 'Importa el corte de Epos, revisa las excepciones y confirma antes de cerrar el día.'
              : 'No se crean cortes ni tareas de venta. Usa este tiempo para compras, recetas o administración.'}
          </p>
        </div>
        {usuario.rol === 'admin' && (
          <div className="operating-brief__meta">
            <span className={semana?.estado === 'cerrada' ? 'badge-ok' : 'badge-neutral'}>
              {semana ? `${semana.etiqueta} · ${semana.estado}` : 'Semana actual'}
            </span>
            <Link className="btn-primary" to={operativo ? '/finanzas' : '/inventario'}>
              {operativo ? 'Abrir cierre de hoy' : 'Revisar inventario'}
            </Link>
          </div>
        )}
      </section>

      <div className="section-heading">
        <div>
          <span className="eyebrow">Flujo principal</span>
          <h2>Qué puedes hacer ahora</h2>
        </div>
      </div>

      <div className="module-grid">
        {visibles.map((m) =>
          m.ruta ? (
            <Link key={m.clave} className="module-card module-card--active" to={m.ruta}>
              <span className="module-icon"><Icono name={m.icono} size={22} /></span>
              <strong>{m.titulo}</strong>
              <small>{m.desc}</small>
            </Link>
          ) : (
            <button key={m.clave} className="module-card" disabled>
              <span className="module-icon"><Icono name={m.icono} size={22} /></span>
              <strong>{m.titulo}</strong>
              <small>{m.desc}</small>
              <em className="badge-soon">próximamente</em>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
