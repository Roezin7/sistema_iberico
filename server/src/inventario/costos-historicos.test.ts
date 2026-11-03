import { describe, expect, it } from 'vitest';
import { costoBaseHistorico, seleccionarCostoHistorico, type CostoHistorico } from './costos-historicos.js';
const current = { unit_cost: 243.75, contenido_compra: 700, unidad_base: 'ml' };
const old: CostoHistorico = { id: 1n, fecha: new Date(0), vigente_desde: new Date(0), costo: 255, contenido_compra: 750, unidad_base: 'ml' };
const now: CostoHistorico = { id: 2n, fecha: new Date('2026-11-03'), vigente_desde: new Date('2026-11-03T08:40:00Z'), costo: 243.75, contenido_compra: 700, unidad_base: 'ml' };
describe('costo de snapshots y cambios de presentación', () => {
  it('un cierre previo conserva 255/750 aunque hoy la botella sea 700 ml', () => {
    const h = seleccionarCostoHistorico([now, old], new Date('2026-11-02T02:49:20Z'));
    expect(h).toBe(old); expect(costoBaseHistorico(current, h)).toBe(0.34);
  });
  it('distingue antes y después de un cambio en el mismo día', () => {
    expect(seleccionarCostoHistorico([now, old], new Date('2026-11-03T08:39:59Z'))).toBe(old);
    expect(seleccionarCostoHistorico([old, now], new Date('2026-11-03T08:40:00Z'))).toBe(now);
    expect(costoBaseHistorico(current, now)).toBeCloseTo(243.75 / 700, 10);
  });
  it('desempata por ID y admite historial legado por fecha', () => {
    const legacy = { ...old, id: 3n, fecha: new Date('2026-10-01'), vigente_desde: null, costo: 240 };
    expect(seleccionarCostoHistorico([old, legacy], new Date('2026-10-02'))).toBe(legacy);
    expect(seleccionarCostoHistorico([old, { ...old, id: 9n }], new Date('2026-10-02'))?.id).toBe(9n);
  });
  it('no convierte un costo desconocido en el costo actual', () => {
    expect(costoBaseHistorico(current, { ...old, costo: null })).toBeNull();
    expect(seleccionarCostoHistorico([now], new Date('2026-10-01'))).toBeNull();
    expect(costoBaseHistorico(current, null)).toBeCloseTo(243.75 / 700, 10);
  });
});
