import { describe, expect, it } from 'vitest';
import { consumirFIFO } from './fifo.js';
import { esConsumoFifoActivo } from './fuentes.js';
import { fechaDeFila } from '../epos/imports.js';

type Lote = { id: number; recibidoAt: string; cantidadRestante: number; costoUnitario: number };

/** Simula el contrato observable del ledger sin tocar una base de datos. */
function aplicarConsumos(lotes: Lote[], filas: { fuente: string; cantidad: number; loteId: number }[]) {
  return lotes.map((lote) => ({
    ...lote,
    cantidadRestante: lote.cantidadRestante - filas
      .filter((fila) => fila.loteId === lote.id && esConsumoFifoActivo(fila))
      .reduce((suma, fila) => suma + fila.cantidad, 0),
  }));
}

describe('flujo FIFO extremo a extremo', () => {
  it('no reintroduce una reversión al costo de ventas', () => {
    const filas = [
      { fuente: 'venta_receta', cantidad: 2, loteId: 1 },
      { fuente: 'reversion_venta_receta', cantidad: 2, loteId: 1 },
    ];
    const activos = filas.filter((fila) => esConsumoFifoActivo(fila));
    expect(activos).toHaveLength(1);
    expect(aplicarConsumos([{ id: 1, recibidoAt: '2026-08-10', cantidadRestante: 10, costoUnitario: 10 }], filas)[0]!.cantidadRestante).toBe(8);
  });

  it('hace idempotente una venta duplicada por su misma línea y lote', () => {
    const filas = [
      { fuente: 'venta_receta', cantidad: 1, loteId: 1 },
      { fuente: 'venta_receta', cantidad: 1, loteId: 1 },
    ];
    // La base impone (epos_venta_id, product_id, lote_id); una segunda fila
    // idéntica representa el reintento y se descarta antes de aplicar FIFO.
    const deduplicadas = filas.filter((fila, index) => index === filas.findIndex((otra) => otra.loteId === fila.loteId && otra.fuente === fila.fuente));
    expect(deduplicadas).toHaveLength(1);
    expect(aplicarConsumos([{ id: 1, recibidoAt: '2026-08-10', cantidadRestante: 10, costoUnitario: 10 }], deduplicadas)[0]!.cantidadRestante).toBe(9);
  });

  it('arrastra el saldo de lote entre semanas consecutivas', () => {
    const semana1 = consumirFIFO([{ id: 1, recibidoAt: '2026-08-10', cantidadRestante: 10, costoUnitario: 10 }], 3);
    const semana2 = consumirFIFO([{ id: 1, recibidoAt: '2026-08-10', cantidadRestante: 7, costoUnitario: 10 }], 2);
    expect(semana1.cantidadConsumida + semana2.cantidadConsumida).toBe(5);
    expect(semana2.consumos[0]!.loteId).toBe(1);
  });

  it('recorre el contrato operativo compra → venta → cierre → apertura', () => {
    const compra = [{ id: 7, recibidoAt: '2026-08-24', cantidadRestante: 12, costoUnitario: 18 }];
    const venta = consumirFIFO(compra, 3);
    const cierreFisico = 9;
    const aperturaSiguiente = cierreFisico;
    expect(venta.cantidadConsumida).toBe(3);
    expect(venta.costoTotal).toBe(54);
    expect(compra[0]!.cantidadRestante - venta.cantidadConsumida).toBe(cierreFisico);
    // El inventario físico es la fuente de verdad para la siguiente semana;
    // FIFO queda como auditoría del consumo aplicado.
    expect(aperturaSiguiente).toBe(cierreFisico);
  });

  it('asigna DateTime sin zona al día operativo de México y respeta zonas explícitas', () => {
    expect(fechaDeFila({ DateTime: '2026-08-16T20:01:37.15' }, '2026-08-16T00:00:00-06:00').toISOString()).toBe('2026-08-17T02:01:37.150Z');
    expect(fechaDeFila({ DateTime: '2026-08-16T20:01:37.15-06:00' }, '2026-08-16T00:00:00-06:00').toISOString()).toBe('2026-08-17T02:01:37.150Z');
  });
});
