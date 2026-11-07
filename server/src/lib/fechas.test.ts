import { describe, expect, it } from 'vitest';
import { fechaCivilUTC, hoyMexico } from './fechas.js';
describe('fechas civiles de México', () => {
  it.each(['2026-02-30', '2026-11-31', '2026-13-01', '2026-00-10', '2026-11-05T12:00:00Z', ''])('rechaza %s sin desplazar el mes', d => expect(() => fechaCivilUTC(d)).toThrow(/Fecha inválida/));
  it('acepta un día bisiesto real', () => expect(fechaCivilUTC('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z'));
  it('antes de medianoche en México no cambia prematuramente de día', () => expect(hoyMexico(new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05'));
});
