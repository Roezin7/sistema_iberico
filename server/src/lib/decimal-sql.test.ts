import { describe, expect, it } from 'vitest';
import { decimalSql } from './decimal-sql.js';
describe('parámetros NUMERIC exactos', () => {
  it.each([[.56, '0.5600'], [.15, '0.1500'], [29.5735, '29.5735'], [.0001, '0.0001'], [0, '0.0000']])('serializa %s sin float8', (n, esperado) => {
    expect(decimalSql(n)).toBe(esperado);
    expect(typeof decimalSql(n)).toBe('string');
  });
  it('normaliza ruido binario a la escala del libro', () => {
    expect(decimalSql(.1 + .2)).toBe('0.3000');
  });
  it('conserva la escala de costos unitarios', () => {
    expect(decimalSql('0.067273', 6)).toBe('0.067273');
  });
  it('no admite valores no finitos', () => {
    expect(() => decimalSql(Infinity)).toThrow();
  });
});
