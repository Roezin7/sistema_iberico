import { describe, it, expect } from 'vitest';
import { patrimonioNeto } from './logic.js';

describe('patrimonioNeto', () => {
  it('suma activos y resta pasivos', () => {
    // banco 15330.85 + efectivo (caja 13700 + cf 2000) + inventario 36528.55 − pasivos 5000
    expect(patrimonioNeto(15330.85, 15700, 36528.55, 5000)).toBe(62559.4);
  });
  it('sin pasivos = suma de activos', () => {
    expect(patrimonioNeto(10000, 5000, 36528.55, 0)).toBe(51528.55);
  });
  it('pasivos mayores que activos => neto negativo', () => {
    expect(patrimonioNeto(0, 0, 1000, 5000)).toBe(-4000);
  });
});
