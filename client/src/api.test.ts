import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./offline', () => ({ encolar: vi.fn() }));
import { encolar } from './offline';
import { api, getToken, setToken } from './api';

beforeEach(() => {
  const store = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)});
  vi.stubGlobal('window', {setTimeout,clearTimeout,dispatchEvent:vi.fn()});
  vi.mocked(encolar).mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe('respuestas y reintentos sin falsa confirmación', () => {
  it('un HTML 200 no se da por guardado como si fuera JSON', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>Error de proxy</html>',{status:200})));
    await expect(api('/finanzas/movimientos',{method:'POST',body:{}})).rejects.toThrow(/formato válido/);
    expect(encolar).not.toHaveBeenCalled();
  });
  it('una sesión rechazada limpia el token y avisa a la interfaz', async () => {
    setToken('token');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Sesión vencida'}),{status:401})));
    await expect(api('/auth/me')).rejects.toThrow(/Sesión vencida/);expect(getToken()).toBeNull();expect(window.dispatchEvent).toHaveBeenCalled();
  });
  it('no encola un pago tras un corte de red', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Sin red')));
    await expect(api('/finanzas/movimientos',{method:'POST',body:{}})).rejects.toThrow(/requiere conexión/);expect(encolar).not.toHaveBeenCalled();
  });
  it('sí conserva un borrador de compra sin afirmar que está confirmado', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Sin red')));
    expect(await api('/inventario/compras/rapidas',{method:'POST',body:{solicitud_id:'prueba'}})).toEqual({queued:true});expect(encolar).toHaveBeenCalledOnce();
  });
});
