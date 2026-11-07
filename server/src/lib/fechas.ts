import { z } from 'zod';
import { HttpError } from '../middleware/error.js';

/** Fecha civil real: no aceptar 30 de febrero ni convertirlo al mes siguiente. */
export const fechaCivilSchema = z.string().date();
export function fechaCivilUTC(value: string): Date {
  if (!fechaCivilSchema.safeParse(value).success) throw new HttpError(400, 'Fecha inválida; usa una fecha real en formato AAAA-MM-DD');
  return new Date(`${value}T00:00:00.000Z`);
}
export function hoyMexico(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
