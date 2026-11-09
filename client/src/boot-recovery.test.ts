import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="iberico-boot-recovery">([\s\S]*?)<\/script>/)![1];
function setup({ online = true, previous = '', query = '', storageBroken = false, stuck = false } = {}) {
  let loading = true;
  let mutation = () => {};
  const events: Record<string, (event?: unknown) => void> = {};
  const span = { textContent: '' };
  const storage = new Map([['iberico-boot-retry-at', previous]]);
  const unregister = vi.fn().mockResolvedValue(true), unrelated = vi.fn();
  const location = { href: 'https://iberico.buzz/inventario?semana=75&tipo=cierre' + query + '#local', origin: 'https://iberico.buzz', replace: vi.fn() };
  const caches = { keys: vi.fn().mockResolvedValue(['workbox-precache-v2-https://iberico.buzz/', 'otra-cache', 'workbox-precache-v2-https://otro.example/']), delete: vi.fn().mockResolvedValue(true) };
  const navigator = { onLine: online, serviceWorker: { getRegistrations: vi.fn().mockImplementation(() => stuck ? new Promise(() => {}) : Promise.resolve([
    {active:{scriptURL:'https://iberico.buzz/sw.js'},unregister},
    {active:{scriptURL:'https://iberico.buzz/otro/sw.js'},unregister:unrelated},
  ])) } };
  const history = { state: { existing: true }, replaceState: vi.fn() };
  const window = { location, caches, addEventListener: (name: string, cb: typeof events[string]) => {events[name] = cb;} };
  runInNewContext(source, {
    URL, Date, Promise, location, history, window, navigator, caches, setTimeout, clearTimeout,
    sessionStorage: { getItem: (k: string) => {if(storageBroken)throw Error('blocked');return storage.get(k);}, setItem: (k: string,v: string) => {if(storageBroken)throw Error('blocked');storage.set(k,v);} },
    document: { getElementById: (id: string) => id === 'boot-fallback' ? (loading ? {} : null) : id === 'boot-retry' ? {addEventListener: (_: string,cb: typeof events[string]) => {events.retry = cb;}} : {}, querySelector: () => loading ? span : null },
    MutationObserver: class { constructor(cb: () => void){mutation=cb;} observe(){} disconnect(){} },
  });
  return { events, span, storage, location, caches, unregister, unrelated, history, navigator, mounted: () => {loading=false;mutation();} };
}

beforeEach(() => {vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));});
afterEach(() => vi.useRealTimers());
describe('recuperación de arranque sin depender del bundle', () => {
  it('un módulo que no termina de descargar se recupera tras un tiempo limitado', async () => {
    const e=setup();await vi.advanceTimersByTimeAsync(16000);expect(e.location.replace).toHaveBeenCalledOnce();
  });
  it('recupera un módulo fallido conservando ruta, semana y fragmento; sólo limpia su caché de código', async () => {
    const e=setup();e.events.error({target:{tagName:'SCRIPT',type:'module'}});await vi.advanceTimersByTimeAsync(1);
    expect(e.location.replace).toHaveBeenCalledOnce();
    const next=new URL(e.location.replace.mock.calls[0][0]);
    expect(next.pathname).toBe('/inventario');expect(next.searchParams.get('semana')).toBe('75');expect(next.hash).toBe('#local');
    expect(e.unregister).toHaveBeenCalledOnce();expect(e.unrelated).not.toHaveBeenCalled();
    expect(e.caches.delete.mock.calls).toEqual([['workbox-precache-v2-https://iberico.buzz/']]);
  });
  it('no entra en bucle si ya intentó recuperar durante los últimos cinco minutos', async () => {
    const e=setup({previous:String(Date.now()-1000)});await vi.advanceTimersByTimeAsync(16000);
    expect(e.location.replace).not.toHaveBeenCalled();expect(e.span.textContent).toContain('No se pudo iniciar');
  });
  it('el límite también funciona por URL cuando sessionStorage está bloqueado', async () => {
    const e=setup({storageBroken:true,query:'&__iberico_recovery='+Date.now()});await vi.advanceTimersByTimeAsync(16000);
    expect(e.location.replace).not.toHaveBeenCalled();expect(e.span.textContent).toContain('No se pudo iniciar');
  });
  it('si no hay red muestra una salida y recupera al volver la conexión', async () => {
    const e=setup({online:false});await vi.advanceTimersByTimeAsync(16000);expect(e.location.replace).not.toHaveBeenCalled();expect(e.span.textContent).toContain('Sin conexión');
    e.navigator.onLine=true;e.events.online();await vi.advanceTimersByTimeAsync(1);expect(e.location.replace).toHaveBeenCalledOnce();
  });
  it('un CacheStorage o service worker bloqueado no deja esperando para siempre', async () => {
    const e=setup({stuck:true});e.events.retry();await vi.advanceTimersByTimeAsync(2100);expect(e.location.replace).toHaveBeenCalledOnce();
  });
  it('un arranque sano detiene el watchdog y limpia sólo el parámetro de recuperación', async () => {
    const e=setup({query:'&__iberico_recovery='+Date.now()});e.mounted();await vi.advanceTimersByTimeAsync(16000);
    expect(e.location.replace).not.toHaveBeenCalled();expect(e.history.replaceState).toHaveBeenCalledWith({existing:true},'', 'https://iberico.buzz/inventario?semana=75&tipo=cierre#local');
  });
  it('un error después de montar no recarga automáticamente ni pone en riesgo una captura', async () => {
    const e=setup();e.mounted();e.events.error({target:{tagName:'SCRIPT',type:'module'}});await vi.advanceTimersByTimeAsync(16000);expect(e.location.replace).not.toHaveBeenCalled();
    e.events['iberico:recover']();await vi.advanceTimersByTimeAsync(1);expect(e.location.replace).toHaveBeenCalledOnce();
  });
  it('un fallo persistente permite un reintento manual explícito', async () => {
    const e=setup({previous:String(Date.now())});await vi.advanceTimersByTimeAsync(16000);e.events.retry();await vi.advanceTimersByTimeAsync(1);expect(e.location.replace).toHaveBeenCalledOnce();
  });
  it('no permite que Google Fonts bloquee el script de inicio', () => {
    expect(html).toMatch(/href="https:\/\/fonts.googleapis.com[^>]+media="print"/);
    expect(html).toContain("fonts.addEventListener('load'");
    expect(html).not.toContain('onload='); // compatible con CSP script-src-attr none.
  });
});
