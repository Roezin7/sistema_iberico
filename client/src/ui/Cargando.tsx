import { Icono } from '../icons';

/** Estado de carga reutilizable (reemplaza el <p className="muted">Cargando…</p> plano). */
export function Cargando({ etiqueta = 'Cargando…' }: { etiqueta?: string }) {
  return (
    <div className="cargando">
      <Icono name="refresh" size={18} className="cargando__spin" />
      <span className="muted">{etiqueta}</span>
    </div>
  );
}
