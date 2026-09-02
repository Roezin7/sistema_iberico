import { describe, expect, it } from 'vitest';
import { etiquetaCanonica, numeroSemanaCalendario } from './weeks.js';

const fecha = (valor: string) => new Date(`${valor}T00:00:00.000Z`);

describe('numeración calendario de semanas', () => {
  it('usa la semana calendario del año', () => {
    expect(numeroSemanaCalendario(fecha('2026-08-31'))).toEqual({ numero: 36, anio: 2026 });
  });

  it('mantiene el rango operativo 1–52', () => {
    expect(numeroSemanaCalendario(fecha('2026-12-21'))).toEqual({ numero: 52, anio: 2026 });
    expect(numeroSemanaCalendario(fecha('2026-12-28'))).toEqual({ numero: 1, anio: 2026 });
  });

  it('reinicia el número al iniciar el siguiente año calendario', () => {
    expect(numeroSemanaCalendario(fecha('2027-01-04'))).toEqual({ numero: 1, anio: 2027 });
  });

  it('conserva fechas completas en la etiqueta para evitar ambigüedad histórica', () => {
    expect(etiquetaCanonica(fecha('2026-08-31'), fecha('2026-09-06')))
      .toBe('Semana 36 · 2026 (2026-08-31 → 2026-09-06)');
  });
});
