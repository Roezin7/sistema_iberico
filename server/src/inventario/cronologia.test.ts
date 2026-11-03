import { describe, expect, it } from 'vitest';
import { reconstruirZonas, referenciaDiaMexico, instanteReal, type AnclaZona } from './cronologia.js';
import { consumirFIFO } from './fifo.js';
const date = (time: string) => new Date(`2026-11-01T${time}:00-06:00`);
const anchors = (local = '21:00', bodega = '20:00'): AnclaZona[] => [{ zonaId: 1, nombre: 'Local', cantidad: 10, corte: date(local) }, { zonaId: 2, nombre: 'Bodega', cantidad: 20, corte: date(bodega) }];
describe('cronología física por zona', () => {
  it('una venta entre cortes no vuelve a descontar la Bodega anterior', () => {
    const r = reconstruirZonas(anchors(), [{ tipo: 'venta', fecha: date('20:40'), cantidad: 4 }]);
    expect(r.total).toBe(30); expect(r.saldos.get(2)).toBe(20);
  });
  it('ventas después del corte Local se descuentan aunque Bodega tenga corte posterior', () => {
    const r = reconstruirZonas(anchors('20:00', '21:00'), [{ tipo: 'venta', fecha: date('20:40'), cantidad: 4 }]);
    expect(r.total).toBe(26); expect(r.saldos.get(1)).toBe(6);
  });
  it('una compra entre cortes entra sólo en Bodega si no estaba contada allí', () => {
    expect(reconstruirZonas(anchors(), [{ tipo: 'entrada', fecha: date('20:40'), cantidad: 5, zonaId: 2 }]).total).toBe(35);
    expect(reconstruirZonas(anchors('20:00', '21:00'), [{ tipo: 'entrada', fecha: date('20:40'), cantidad: 5, zonaId: 2 }]).total).toBe(30);
  });
  it('no usa una recepción posterior para cubrir una venta anterior', () => {
    const a = anchors(); a.forEach(x => { x.cantidad = 0; });
    const r = reconstruirZonas(a, [{ tipo: 'entrada', fecha: date('22:00'), cantidad: 5, zonaId: 2 }, { tipo: 'venta', fecha: date('21:30'), cantidad: 3 }]);
    expect(r.total).toBe(5); expect(r.noCubierto).toBe(3);
  });
  it('transferencias respetan cada lado del corte sin duplicar recepción en destino', () => {
    const r = reconstruirZonas(anchors(), [{ tipo: 'transferencia', fecha: date('20:40'), cantidad: 5, origen: 2, destino: 1 }]);
    expect(r.saldos.get(2)).toBe(15); expect(r.saldos.get(1)).toBe(10);
    const both = reconstruirZonas(anchors(), [{ tipo: 'transferencia', fecha: date('21:30'), cantidad: 5, origen: 2, destino: 1 }]);
    expect(both.total).toBe(30); expect(both.saldos.get(1)).toBe(15);
  });
  it('igual al corte ya está contado; no produce una segunda entrada/salida', () => {
    const r = reconstruirZonas(anchors(), [{ tipo: 'entrada', fecha: date('20:00'), cantidad: 5, zonaId: 2 }, { tipo: 'venta', fecha: date('21:00'), cantidad: 4 }]);
    expect(r.total).toBe(30);
  });
  it('un traslado posterior a ambos cortes no inventa stock si origen no alcanza', () => {
    const r = reconstruirZonas(anchors(), [{ tipo: 'transferencia', fecha: date('21:30'), cantidad: 25, origen: 2, destino: 1 }]);
    expect(r.total).toBe(30); expect(r.saldos.get(1)).toBe(30); expect(r.noCubierto).toBe(5);
  });
  it('salidas documentadas se aplican a su zona, no a un corte global', () => {
    const r = reconstruirZonas(anchors(), [{ tipo: 'salida', fecha: date('20:40'), cantidad: 3, zonaId: 2 }]);
    expect(r.total).toBe(27);
  });
  it('el legado usa inicio del día de México y nunca hora de captura como recepción', () => {
    expect(referenciaDiaMexico(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(instanteReal(null)).toBeNull();
    expect(() => instanteReal('no-fecha')).toThrow();
    expect(() => instanteReal(new Date('2030-01-01'), date('20:00'))).toThrow();
  });
  it('una recepción conocida de la noche anterior precede al lote legado del día siguiente', () => {
    const r = consumirFIFO([
      { id: 1, recibidoAt: referenciaDiaMexico(new Date('2026-11-02T00:00:00Z')).toISOString(), cantidadRestante: 1, costoUnitario: 3 },
      { id: 2, recibidoAt: date('23:30').toISOString(), cantidadRestante: 1, costoUnitario: 2 },
    ], 1);
    expect(r.consumos[0]?.loteId).toBe(2); expect(r.costoTotal).toBe(2);
  });
});
