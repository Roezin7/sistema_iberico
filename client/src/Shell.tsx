import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { useTema } from './theme';
import { Icono } from './icons';
import { useOffline } from './offline';
import NodoIsotipo from './brand/NodoIsotipo';

interface Item { ruta: string; label: string; description: string; icono: Parameters<typeof Icono>[0]['name']; soloAdmin?: boolean }

const MAIN_ITEMS: Item[] = [
  { ruta: '/', label: 'Inicio', description: 'Control general', icono: 'home' },
  { ruta: '/operacion', label: 'Operación', description: 'Lo de hoy', icono: 'sunrise' },
  { ruta: '/inventario', label: 'Inventario', description: 'Existencias y faltantes', icono: 'package' },
  { ruta: '/compras', label: 'Compras', description: 'Tickets y lotes', icono: 'wallet' },
  { ruta: '/costos-menu', label: 'Menú', description: 'Precios y márgenes', icono: 'trending', soloAdmin: true },
  { ruta: '/finanzas', label: 'Reportes', description: 'Resultado y cierre', icono: 'file', soloAdmin: true },
];

const TOOL_ITEMS: Item[] = [
  { ruta: '/tareas', label: 'Checklist', description: 'Tareas del día', icono: 'checks' },
  { ruta: '/facturacion', label: 'Facturación', description: 'Comprobantes mensuales', icono: 'file', soloAdmin: true },
  { ruta: '/decisiones', label: 'Decisiones', description: 'Alertas y prioridades', icono: 'alertTriangle', soloAdmin: true },
  { ruta: '/patrimonio', label: 'Patrimonio', description: 'Activos y pasivos', icono: 'trending', soloAdmin: true },
  { ruta: '/configuracion', label: 'Configuración', description: 'Catálogo e integraciones', icono: 'settings', soloAdmin: true },
];

const QUICK_ITEMS = [
  { ruta: '/compras', label: 'Registrar compra o gasto', description: 'Sube un ticket y envíalo a revisión', icono: 'package' as const },
  { ruta: '/inventario?tipo=cierre', label: 'Abrir conteo físico', description: 'Apertura, cierre o ajuste documentado', icono: 'checks' as const },
  { ruta: '/operacion', label: 'Abrir jornada', description: 'Ventas, caja, tareas y pendientes', icono: 'sunrise' as const },
  { ruta: '/finanzas?tab=dia', label: 'Revisar corte Epos', description: 'Conciliación de ventas y métodos de pago', icono: 'wallet' as const },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { online, pendientes, sincronizar } = useOffline();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const admin = usuario?.rol === 'admin';
  const mainItems = useMemo(() => MAIN_ITEMS.filter((i) => !i.soloAdmin || admin), [admin]);
  const toolItems = useMemo(() => TOOL_ITEMS.filter((i) => !i.soloAdmin || admin), [admin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); }
      if (event.key === 'Escape') { setPaletteOpen(false); setToolsOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setPaletteOpen(false); }, [location.pathname]);

  const syncChip = !online ? <button className="sync-chip sync-chip--off" onClick={() => void sincronizar()}><span className="sync-dot" /> Sin conexión{pendientes > 0 && ` · ${pendientes} pendientes`}</button> : pendientes > 0 ? <button className="sync-chip sync-chip--pending" onClick={() => void sincronizar()}><span className="sync-dot" /> Sincronizar {pendientes}</button> : <span className="sync-chip"><span className="sync-dot sync-dot--ok" /> Todo al día</span>;

  return <div className="shell">
    <aside className="nav-rail">
      <div className="nav-brand"><NodoIsotipo size={30} /><div><span className="nav-wordmark">IBÉRICO</span><small>Centro de mando</small></div></div>
      <button className="nav-create" onClick={() => setPaletteOpen(true)}><span>+</span><strong>Registrar</strong><kbd>⌘K</kbd></button>
      <nav className="nav-links" aria-label="Navegación principal">
        <span className="nav-section-label">Espacio de trabajo</span>
        {mainItems.map((item) => <NavLink key={item.ruta} to={item.ruta} end={item.ruta === '/'} className={({ isActive }) => isActive ? 'nav-link nav-link--on' : 'nav-link'}><Icono name={item.icono} size={19} /><span><strong>{item.label}</strong><small>{item.description}</small></span></NavLink>)}
        <button className={`nav-link nav-link--button ${toolsOpen ? 'nav-link--expanded' : ''}`} onClick={() => setToolsOpen((open) => !open)}><Icono name="sparkles" size={19} /><span><strong>Herramientas</strong><small>{toolsOpen ? 'Ocultar accesos' : 'Más controles'}</small></span><Icono name="chevron" size={15} className="nav-chevron" /></button>
        {toolsOpen && <div className="nav-tools">{toolItems.map((item) => <NavLink key={item.ruta} to={item.ruta} className={({ isActive }) => isActive ? 'nav-link nav-link--compact nav-link--on' : 'nav-link nav-link--compact'}><Icono name={item.icono} size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span></NavLink>)}</div>}
      </nav>
      <div className="nav-foot"><div className="nav-account"><span className="avatar">{usuario?.nombre?.slice(0, 1).toUpperCase() ?? 'I'}</span><span><strong>{usuario?.nombre ?? 'Usuario'}</strong><small>{usuario?.rol === 'admin' ? 'Administrador' : 'Operación'}</small></span></div><button className="nav-link nav-link--button" onClick={alternar}><Icono name={tema === 'dark' ? 'sun' : 'moon'} size={19} /><span><strong>{tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}</strong><small>Preferencia visual</small></span></button><button className="nav-link nav-link--button" onClick={logout}><Icono name="logout" size={19} /><span><strong>Salir</strong><small>Cerrar sesión</small></span></button></div>
    </aside>
    <div className="main-area">
      <header className="context-bar"><div className="context-bar__left"><span className="context-brand">Ibérico</span><span className="context-divider" /><span className="context-page">{location.pathname === '/' ? 'Inicio' : mainItems.find((item) => location.pathname.startsWith(item.ruta) && item.ruta !== '/')?.label ?? toolItems.find((item) => location.pathname.startsWith(item.ruta))?.label ?? 'Espacio de trabajo'}</span></div><div className="context-bar__right"><button className="global-search" onClick={() => setPaletteOpen(true)}><Icono name="search" size={16} /><span>Buscar en Ibérico</span><kbd>⌘K</kbd></button>{syncChip}<button className="icon-btn" onClick={alternar} aria-label="Cambiar tema" title="Cambiar tema"><Icono name={tema === 'dark' ? 'sun' : 'moon'} size={18} /></button></div></header>
      <main className="content">{children}</main>
    </div>
    <nav className="bottom-nav">{mainItems.slice(0, 4).map((item) => <NavLink key={item.ruta} to={item.ruta} end={item.ruta === '/'} className={({ isActive }) => isActive ? 'bottom-link bottom-link--on' : 'bottom-link'}><Icono name={item.icono} size={21} /><span>{item.label}</span></NavLink>)}</nav>
    {paletteOpen && <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Registrar o navegar"><div className="command-palette__head"><div><span className="eyebrow">Acceso rápido</span><h2>¿Qué necesitas hacer?</h2></div><button className="icon-btn" onClick={() => setPaletteOpen(false)} aria-label="Cerrar"><Icono name="x" size={18} /></button></div><div className="command-palette__search"><Icono name="search" size={18} /><input autoFocus placeholder="Buscar una acción…" onChange={(event) => { const term = event.target.value.toLowerCase(); document.querySelectorAll<HTMLElement>('[data-command-item]').forEach((el) => { el.hidden = !el.dataset.commandItem?.includes(term); }); }} /></div><div className="command-list">{QUICK_ITEMS.filter((item) => !item.ruta.startsWith('/finanzas') || admin).map((item) => <button data-command-item={`${item.label} ${item.description}`.toLowerCase()} key={item.ruta} onClick={() => { setPaletteOpen(false); navigate(item.ruta); }}><span className="command-icon"><Icono name={item.icono} size={18} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><Icono name="chevron" size={16} /></button>)}</div><p className="command-hint">Esc para cerrar · ⌘K para abrir desde cualquier pantalla</p></section></div>}
  </div>;
}
