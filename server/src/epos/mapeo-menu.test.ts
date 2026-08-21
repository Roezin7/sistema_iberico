import { describe, expect, it } from 'vitest';
import { normalizarNombreEpos } from './mapeo-menu.js';

describe('normalizarNombreEpos', () => {
  it('iguala acentos, mayúsculas y puntuación', () => {
    expect(normalizarNombreEpos('Margarita de Fresa')).toBe(normalizarNombreEpos(' margarita  de fresa '));
    expect(normalizarNombreEpos('Piña Colada')).toBe('pina colada');
  });

  it('omite la variante entre paréntesis para mapear el nombre comercial', () => {
    expect(normalizarNombreEpos('Horchata (Ronchata)')).toBe('horchata');
  });
});
