/** Compartida por el alta y la reproducción: ni colas antiguas pueden aplicar
 * pagos, conteos o cierres fuera de su revisión interactiva. */
export function puedeEncolar(method: string, path: string) {
  return (method.toUpperCase() === 'PATCH' && path === '/tareas/resultados')
    || (method.toUpperCase() === 'POST' && path === '/inventario/compras/rapidas');
}
/** Identidad para separar la cola local. La autorización real sigue siendo
 * del servidor; esta lectura del token sólo evita cruzar sesiones del equipo. */
export function propietarioToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub && payload.negocio_id ? `${payload.negocio_id}:${payload.sub}` : null;
  } catch { return null; }
}
