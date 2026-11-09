import { describe, expect, it } from 'vitest';
import { validarPresentacionesConteo } from './conteo-presentaciones.js';
describe('unidades físicas del conteo', () => {
  const botella = (unidades: number, contenido_base: number) => ({ unidades, contenido_base, unidad_base: 'ml', etiqueta: 'botella' });
  it('suma 2 de 600 ml y media de 2 L sin confundir unidades', () => {
    const r = validarPresentacionesConteo({cantidad_base:2200,presentaciones:[botella(2,600),botella(.5,2000)]},'ml');
    expect(JSON.parse(r!)).toHaveLength(2);
  });
  it('no reinterpreta conteos antiguos sin desglose', () => {
    expect(validarPresentacionesConteo({cantidad_base:440},'g')).toBeNull();
  });
  it('rechaza un total base que no coincide con las unidades', () => {
    expect(()=>validarPresentacionesConteo({cantidad_base:2,presentaciones:[botella(2,600)]},'ml')).toThrow(/no coinciden/);
  });
  it('no permite pesar un producto de volumen por accidente', () => {
    expect(()=>validarPresentacionesConteo({cantidad_base:1200,presentaciones:[botella(2,600)]},'g')).toThrow(/incompatible/);
  });
  it('acepta cero explícito, sin convertir ausencia en cero', () => {
    expect(validarPresentacionesConteo({cantidad_base:0,presentaciones:[botella(0,600)]},'ml')).not.toBeNull();
  });
  it('mantiene precisión decimal a cuatro lugares', () => {
    expect(validarPresentacionesConteo({cantidad_base:.56,presentaciones:[botella(.2,2.8)]},'ml')).not.toBeNull();
  });
});
