import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Icono } from '../icons';
import { finanzas, epos, mxn, type ConciliacionDiaria, type DiaFila, type Resumen, type Semana } from './finanzas/api';
import { weekLabel, weekStateLabel } from '../operating';

interface Modulo {
  clave: string;
  titulo: string;
  icono: Parameters<typeof Icono>[0]['name'];
  desc: string;
  ruta?: string; // si no hay ruta -> aún no disponible
  soloAdmin?: boolean;
}

const MODULOS: Modulo[] = [
  { clave: 'compras', titulo: 'Entradas', icono: 'package', desc: 'Tickets, gastos y lotes FIFO', ruta: '/compras' },
  { clave: 'inventario', titulo: 'Inventario', icono: 'package', desc: 'Conteos y lista de compras', ruta: '/inventario' },
  { clave: 'finanzas', titulo: 'Cierre', icono: 'wallet', desc: 'Ventas, egresos, patrimonio y cierre', ruta: '/finanzas', soloAdmin: true },
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
  const [estado, setEstado] = useState<{
    semana: Semana | null;
    dia: DiaFila | null;
    conciliacion: ConciliacionDiaria | null;
    resumen: Resumen | null;
    cargando: boolean;
    error: string;
  }>({ semana: null, dia: null, conciliacion: null, resumen: null, cargando: true, error: '' });

  const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const weekdayMx = new Date(`${hoyMx}T12:00:00`).getDay();
  const operativo = weekdayMx === 0 || weekdayMx === 5 || weekdayMx === 6;

  useEffect(() => {
    if (!usuario || usuario.rol !== 'admin') return;
    let activo = true;
    setEstado((prev) => ({ ...prev, cargando: true, error: '' }));
    void finanzas.semanaActual()
      .then(async (semana) => {
        if (!semana) return { semana: null, dia: null, conciliacion: null, resumen: null };
        const [dias, resumen, conciliaciones] = await Promise.all([
          finanzas.dias(semana.id),
          finanzas.resumen(semana.id),
          epos.conciliaciones(semana.id).catch(() => []),
        ]);
        return {
          semana,
          dia: dias.dias.find((dia) => dia.fecha === hoyMx) ?? null,
          conciliacion: conciliaciones.find((c) => c.fecha === hoyMx) ?? null,
          resumen,
        };
      })
      .then((data) => {
        if (activo) setEstado({ ...data, cargando: false, error: '' });
      })
      .catch((error) => {
        if (activo) setEstado((prev) => ({ ...prev, cargando: false, error: error instanceof Error ? error.message : 'No se pudo cargar el estado de hoy' }));
      });
    return () => { activo = false; };
  }, [usuario, hoyMx]);

  if (!usuario) return null;

  const visibles = MODULOS.filter((m) => !m.soloAdmin || usuario.rol === 'admin');
  const { semana, dia, conciliacion, resumen } = estado;
  const estadoHoy = operativo ? (conciliacion ? 'Corte confirmado' : 'Corte pendiente') : 'Sin operación del bar';
  const siguienteAccion = !operativo
    ? 'Revisar inventario y preparar la operación del fin de semana.'
    : conciliacion
      ? resumen?.inventario.estado === 'pendiente_cierre' ? 'Revisar compras y preparar el inventario de cierre.' : 'Revisar el detalle de ventas y excepciones.'
      : 'Importar las ventas de Epos, revisar métodos de pago y confirmar el corte.';
  const accionRuta = operativo ? '/finanzas' : '/inventario';

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
            {estado.error || siguienteAccion}
          </p>
        </div>
        {usuario.rol === 'admin' && (
          <div className="operating-brief__meta">
            <span className={semana?.estado === 'cerrada' ? 'badge-ok' : 'badge-neutral'}>
              {estado.cargando ? 'Cargando estado…' : semana ? `${weekLabel(semana)} · ${weekStateLabel(semana)}` : 'Semana actual'}
            </span>
            <Link className="btn-primary" to={accionRuta}>
              {operativo ? (conciliacion ? 'Abrir operación de hoy' : 'Abrir cierre de hoy') : 'Revisar inventario'}
            </Link>
          </div>
        )}
      </section>

      {usuario.rol === 'admin' && !estado.cargando && semana && (
        <section className="summary-grid home-today-summary" aria-label="Estado operativo de hoy">
          <div><small>Día</small><strong>{dia?.dia ?? hoyMx.slice(5)}</strong><span>{operativo ? 'Viernes a domingo' : 'Sin ventas regulares'}</span></div>
          <div><small>Ventas registradas</small><strong>{dia ? mxn(dia.total_ventas) : '—'}</strong><span>{conciliacion ? 'Corte confirmado' : 'Según captura diaria'}</span></div>
          <div><small>Compras de la semana</small><strong>{resumen ? mxn(resumen.compras_inventario) : '—'}</strong><span>Tickets y lotes FIFO</span></div>
          <div><small>Inventario</small><strong>{resumen?.inventario.estado === 'cerrado' ? 'Cerrado' : 'Pendiente'}</strong><span>{resumen?.inventario.estado === 'cerrado' ? 'Disponible para consulta' : 'Requiere cierre físico'}</span></div>
        </section>
      )}

      <section className="operating-cycle" aria-labelledby="ciclo-operativo-titulo">
        <div className="section-heading">
          <div><span className="eyebrow">Un solo ciclo</span><h2 id="ciclo-operativo-titulo">De la entrada al cierre</h2></div>
          <span className="muted">La misma fuente alimenta cada paso</span>
        </div>
        <div className="operating-cycle__steps">
          <Link to="/compras"><strong>1</strong><span><b>Entradas</b><small>Tickets y gastos</small></span></Link>
          <Link to="/finanzas"><strong>2</strong><span><b>Operación</b><small>Ventas y pagos</small></span></Link>
          <Link to="/inventario"><strong>3</strong><span><b>Inventario</b><small>Conteo físico</small></span></Link>
          <Link to="/finanzas"><strong>4</strong><span><b>Cierre</b><small>FIFO y decisión</small></span></Link>
        </div>
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
