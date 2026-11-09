import { describe, expect, it } from 'vitest';
import { rutaTabAbasto, tabAbasto, type TabAbasto } from './navegacion';

describe('navegación de Abasto con la URL como única fuente de verdad', () => {
  it.each(['conteo', 'actual', 'compras'] as TabAbasto[])('selecciona %s explícitamente', tab => {
    expect(tabAbasto(`?tab=${tab}`)).toBe(tab);
  });
  it.each(['', '?tab=desconocida', '?tab=', '?semana=75&tipo=cierre'])('vuelve a conteo por defecto: %s', search => {
    expect(tabAbasto(search)).toBe('conteo');
  });
  it.each(['actual', 'compras'] as TabAbasto[])('puede regresar de %s a conteo sin perder contexto', origin => {
    const path = rutaTabAbasto(`?semana=75&tipo=cierre&tab=${origin}&zona=2`, 'conteo');
    const search = path.slice(path.indexOf('?'));
    expect(tabAbasto(search)).toBe('conteo');
    const params = new URLSearchParams(search);
    expect(params.get('semana')).toBe('75');
    expect(params.get('tipo')).toBe('cierre');
    expect(params.get('zona')).toBe('2');
    expect(params.getAll('tab')).toEqual(['conteo']);
  });
});
