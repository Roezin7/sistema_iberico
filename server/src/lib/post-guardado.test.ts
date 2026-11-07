import { afterEach, describe, expect, it, vi } from 'vitest';
import { intentarPostGuardado } from './post-guardado.js';
afterEach(() => vi.restoreAllMocks());
describe('tareas posteriores al guardado', () => {
  it('conserva el resultado exitoso', async () => {
    expect(await intentarPostGuardado('costeo_fifo', async () => ({ costeadas: 25 }))).toEqual({ resultado: { costeadas: 25 }, advertencia: null });
  });
  it('reporta el fallo sin aparentar rollback de datos ya guardados', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await intentarPostGuardado('costeo_fifo', async () => { throw Error('Fallo SQL'); });
    expect(r.resultado).toBeNull();
    expect(r.advertencia).toMatchObject({ etapa: 'costeo_fifo', mensaje: expect.stringContaining('sin volver a capturar') });
    expect(r.advertencia?.mensaje).not.toContain('SQL');
  });
  it('distingue un mapeo pendiente de un costeo completado', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await intentarPostGuardado('mapeo_epos', async () => { throw Error('Error'); });
    expect(r.resultado).toBeNull();
    expect(r.advertencia?.etapa).toBe('mapeo_epos');
  });
});
