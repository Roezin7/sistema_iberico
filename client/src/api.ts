// Cliente HTTP mínimo para la API. Guarda el JWT en localStorage.

const TOKEN_KEY = 'iberico_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resultado sintético cuando una mutación se encola offline. */
export interface Encolado { queued: true }
export const fueEncolado = (r: unknown): r is Encolado =>
  typeof r === 'object' && r !== null && (r as Encolado).queued === true;

// Sólo se pueden capturar offline acciones que no cierran ni afectan saldos
// irreversibles. Cierres, pagos, confirmaciones y movimientos financieros
// requieren conexión para evitar que una decisión operativa quede pendiente
// o se aplique con una semana distinta al sincronizar.
function puedeGuardarOffline(path: string, body: unknown) {
  if (path === '/tareas/resultados' || path === '/inventario/compras/rapidas') return true;
  if (path === '/inventario/snapshots' && typeof body === 'object' && body !== null) {
    return (body as { tipo?: string }).tipo === 'conteo_operativo';
  }
  return false;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const esMutacion = method !== 'GET' && method !== 'HEAD';
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Fallo de red. Si es una mutación, la encolamos para sincronizar luego.
    if (esMutacion && puedeGuardarOffline(path, body)) {
      const { encolar } = await import('./offline');
      await encolar({ method, path, body, token: auth ? getToken() : null });
      return { queued: true } as T;
    }
    throw new ApiError(0, esMutacion ? 'Esta acción requiere conexión para proteger la trazabilidad.' : 'Sin conexión');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null); // token inválido -> forzar re-login
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Error de red');
  }
  return data as T;
}
