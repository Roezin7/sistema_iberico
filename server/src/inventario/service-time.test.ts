import { describe, expect, it } from 'vitest';
import { fechaDbPosteriorAlSnapshot, movimientoPosteriorAlSnapshot } from './service.js';

describe('corte temporal del inventario físico', () => {
  const corte = new Date('2026-11-01T20:40:00.000-06:00');

  it('no descuenta una venta ocurrida antes del inventario aunque se importe después', () => {
    const venta = new Date('2026-11-01T20:39:59.000-06:00');
    const importadaDespues = new Date('2026-11-01T21:00:00.000-06:00');
    expect(movimientoPosteriorAlSnapshot(venta, importadaDespues, corte)).toBe(false);
  });

  it('descuenta una venta ocurrida después del inventario', () => {
    const venta = new Date('2026-11-01T20:40:01.000-06:00');
    expect(movimientoPosteriorAlSnapshot(venta, new Date('2026-11-01T21:00:00.000-06:00'), corte)).toBe(true);
  });

  it('trata la misma hora como incluida en el conteo, no como salida posterior', () => {
    expect(movimientoPosteriorAlSnapshot(corte, new Date('2026-11-01T21:00:00.000-06:00'), corte)).toBe(false);
  });

  it('usa la hora real de la venta cuando el consumo FIFO sólo guarda el día', () => {
    const dia = new Date('2026-11-01T00:00:00.000Z');
    const ventaAntes = new Date('2026-11-01T20:00:00.000-06:00');
    const ventaDespues = new Date('2026-11-01T21:00:00.000-06:00');
    expect(fechaDbPosteriorAlSnapshot(dia, new Date('2026-11-01T22:00:00.000-06:00'), corte, '2026-11-01', ventaAntes)).toBe(false);
    expect(fechaDbPosteriorAlSnapshot(dia, new Date('2026-11-01T22:00:00.000-06:00'), corte, '2026-11-01', ventaDespues)).toBe(true);
  });
});
