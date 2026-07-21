import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Icono } from '../icons';

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
  { clave: 'tareas', titulo: 'Tareas', icono: 'checks', desc: 'Checklists de apertura y cierre', ruta: '/tareas' },
  { clave: 'finanzas', titulo: 'Finanzas', icono: 'wallet', desc: 'Semanas, movimientos, cuadre', ruta: '/finanzas', soloAdmin: true },
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
  if (!usuario) return null;

  const visibles = MODULOS.filter((m) => !m.soloAdmin || usuario.rol === 'admin');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{saludo()}, {usuario.nombre}</h1>
          <p className="page-sub">¿Qué quieres revisar hoy?</p>
        </div>
      </header>

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
