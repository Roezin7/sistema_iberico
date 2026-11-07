import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db.js';
import { importarVentasEpos } from './imports.js';
import { fetchReconcileData } from './client.js';
import { consumirVentasEpos } from '../inventario/consumo-epos.js';
import { aplicarMapeoEpos } from './mapeo-menu.js';
vi.mock('./client.js', async original => ({ ...await original<object>(), fetchReconcileData: vi.fn() }));
vi.mock('../inventario/consumo-epos.js', () => ({ consumirVentasEpos: vi.fn() }));
vi.mock('./mapeo-menu.js', () => ({ aplicarMapeoEpos: vi.fn() }));
const periodo = { negocioId: 1n, from: '2026-11-06T00:00:00-06:00', to: '2026-11-07T00:00:00-06:00' };
let tx: any;
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(fetchReconcileData).mockResolvedValue({
    daily: [{ ValueIncVAT: 100 }],
    bookkeeping: [{ Product: 'QA', ProductID: 1, Quantity: 1, TotalSales: 100, Tender: 'Cash', DateTime: '2026-11-06T20:00:00-06:00' }],
    tenderBreakdown: [],
  });
  tx = { $executeRaw: vi.fn(), epos_importaciones: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 36n }), update: vi.fn().mockResolvedValue({}) },
    epos_ventas: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
  vi.mocked(consumirVentasEpos).mockResolvedValue({ ventas: 1, costeadas: 1, excepciones: 0, pendientes: 0, costo_fifo: 10 } as any);
  vi.mocked(aplicarMapeoEpos).mockResolvedValue({ propuestas: [], aplicadas: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('la importación no se pierde por una tarea posterior', () => {
  it('devuelve ventas y advertencia revisables aunque el costeo falle tras el commit', async () => {
    vi.mocked(consumirVentasEpos).mockRejectedValueOnce(Error('Conflicto FIFO'));
    const r = await importarVentasEpos(periodo);
    expect(r.persistido).toBe(true); expect(r.importacion_id).toBe(36);
    expect(r.bookkeeping.ventas).toBe(100); expect(r.filas_persistidas).toBe(1);
    expect(r.costeo_en_vivo).toBeNull();
    expect(r.advertencias_post_guardado[0]?.etapa).toBe('costeo_fifo');
    expect(tx.epos_ventas.createMany).toHaveBeenCalledTimes(1);
    expect(aplicarMapeoEpos).toHaveBeenCalledTimes(1);
  });
  it('no disfraza un guardado fallido como importación exitosa', async () => {
    tx.epos_ventas.createMany.mockRejectedValueOnce(Error('Error al persistir'));
    await expect(importarVentasEpos(periodo)).rejects.toThrow('Error al persistir');
    expect(consumirVentasEpos).not.toHaveBeenCalled();
  });
  it('conserva el costo si sólo falla la revisión de vínculos', async () => {
    vi.mocked(aplicarMapeoEpos).mockRejectedValueOnce(Error('Error al mapear'));
    const r = await importarVentasEpos(periodo);
    expect(r.persistido).toBe(true); expect(r.costeo_en_vivo?.costeadas).toBe(1);
    expect(r.mapeo_epos).toBeNull();
    expect(r.advertencias_post_guardado[0]?.etapa).toBe('mapeo_epos');
  });
  it('no inventa advertencias cuando todo terminó', async () => {
    expect((await importarVentasEpos(periodo)).advertencias_post_guardado).toEqual([]);
  });
});
