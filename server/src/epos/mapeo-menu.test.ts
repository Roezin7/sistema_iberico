import { describe, expect, it } from 'vitest';
import { normalizarNombreEpos, normalizarNombreMenu } from './mapeo-menu.js';

describe('normalizarNombreEpos', () => {
  it('iguala acentos, mayúsculas y puntuación', () => {
    expect(normalizarNombreEpos('Margarita de Fresa')).toBe(normalizarNombreEpos(' margarita  de fresa '));
    expect(normalizarNombreEpos('Piña Colada')).toBe('pina colada');
  });

  it('omite la variante entre paréntesis para mapear el nombre comercial', () => {
    expect(normalizarNombreEpos('Horchata (Ronchata)')).toBe('horchata');
  });

  it('resuelve alias históricos al mismo nombre canónico', () => {
    expect(normalizarNombreMenu('Q-C-B-A W-D')).toBe('cuba de dobel diamante');
    expect(normalizarNombreMenu('Cuba de doble diamante')).toBe('cuba de dobel diamante');
    expect(normalizarNombreMenu('Pizza Madrileña (4 quesos)')).toBe('pizza madrilena 4 quesos');
  });
});
