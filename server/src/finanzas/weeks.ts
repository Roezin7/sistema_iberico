const MILIS_SEMANA = 7 * 24 * 60 * 60 * 1000;

function fechaUTC(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

function lunesSemanaISO(anio: number): Date {
  // La semana 1 es la que contiene el 4 de enero (convención de calendario).
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const dia = cuatroEnero.getUTCDay() || 7;
  cuatroEnero.setUTCDate(cuatroEnero.getUTCDate() - dia + 1);
  return cuatroEnero;
}

export interface SemanaCalendario {
  numero: number;
  anio: number;
}

/**
 * Devuelve la semana calendario de una semana operativa lunes-domingo.
 * Ibérico trabaja con 52 semanas: una eventual semana 53 vuelve a empezar
 * en 1, sin cambiar las fechas ni el ID interno de la semana.
 */
export function numeroSemanaCalendario(inicio: Date): SemanaCalendario {
  const fecha = fechaUTC(inicio);
  const dia = fecha.getUTCDay() || 7;
  const jueves = new Date(fecha);
  jueves.setUTCDate(jueves.getUTCDate() + 4 - dia);
  const anio = jueves.getUTCFullYear();
  const primeraSemana = lunesSemanaISO(anio);
  const semanaISO = Math.floor((fecha.getTime() - primeraSemana.getTime()) / MILIS_SEMANA) + 1;
  return { numero: ((semanaISO - 1) % 52) + 1, anio };
}

function iso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function etiquetaCanonica(inicio: Date, fin: Date): string {
  const inicioSemana = numeroSemanaCalendario(inicio);
  const finSemana = numeroSemanaCalendario(fin);
  const dias = Math.round((fechaUTC(fin).getTime() - fechaUTC(inicio).getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const semanasCubiertas = Math.max(1, Math.round(dias / 7));
  const numero = semanasCubiertas > 1
    ? `${inicioSemana.numero}–${finSemana.numero}`
    : `${inicioSemana.numero}`;
  const anio = inicioSemana.anio === finSemana.anio
    ? `${inicioSemana.anio}`
    : `${inicioSemana.anio}–${finSemana.anio}`;
  return `Semana ${numero} · ${anio} (${iso(inicio)} → ${iso(fin)})`;
}
