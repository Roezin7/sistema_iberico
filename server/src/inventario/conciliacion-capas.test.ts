import { describe, it, expect } from 'vitest';
import { conciliarCapas } from './conciliacion-capas.js';
import { loteElegibleParaReceta, saldoEnvasesCompletos } from './presentaciones.js';
const capas = () => [{ id: 1n, cantidad: 1, reservado: 0, costo: 20, orden: new Date('2026-10-19') }, { id: 2n, cantidad: 2, reservado: 0, costo: 22, orden: new Date('2026-10-23') }];
describe('conciliación de cierre sin arrastres', () => {
  it('3 esperadas, 2 contadas: ajusta 1 antigua y conserva 2 nuevas al mismo costo', () => { const p = conciliarCapas(capas(), 2); expect(p.diferencia).toBe(-1); expect(p.detalle.map(c => [c.conservar,c.ajuste,c.costo])).toEqual([[0,1,20],[2,0,22]]); });
  it('un sobrante no es una compra ni tiene un costo confirmado inventado', () => { const p = conciliarCapas(capas(), 4); expect(p.sobrante).toBe(1); expect(p.detalle.every(c => c.ajuste === 0)).toBe(true); });
  it('una semana sin diferencia conserva todas las capas', () => { expect(conciliarCapas(capas(), 3).detalle.map(c => c.conservar)).toEqual([1,2]); });
  it('cero físico deja cero de cada capa', () => { expect(conciliarCapas(capas(), 0).detalle.map(c => c.conservar)).toEqual([0,0]); });
  it('no cambia costos de consumos posteriores ya registrados', () => { const c = capas(); c[0]!.reservado = 1; expect(conciliarCapas(c, 2).detalle.map(c => c.conservar)).toEqual([1,1]); });
  it('rechaza contradicción cronológica, no fuerza un lote negativo', () => { const c = capas(); c[0]!.reservado = 1; expect(() => conciliarCapas(c, 0)).toThrow(/posteriores/); });
  it('rechaza cantidades inválidas', () => { for (const n of [-1,NaN,Infinity]) expect(() => conciliarCapas(capas(), n)).toThrow(); });
  it('no muta el libro de entrada', () => { const c = capas(); conciliarCapas(c, 2); expect(c[0]!.cantidad).toBe(1); });
  it('mantiene precisión en fracciones', () => { const c = capas(); c[0]!.cantidad = .3333; expect(conciliarCapas(c, 2.1).detalle.map(c => c.conservar)).toEqual([.1,2]); });
});
describe('servicios por presentación', () => {
  it('3 L de formato 2 L no sustituyen cinco minerales de 600 ml', () => { expect(loteElegibleParaReceta({ contenido_presentacion:2000,cantidad_restante:6000 },{contenido_requerido:600,envases_completos:true},'ml')).toBe(false); });
  it('contenido desconocido no se adivina', () => { expect(loteElegibleParaReceta({cantidad_restante:3000},{contenido_requerido:600,envases_completos:true},'ml')).toBe(false); });
  it('Coca por pieza también distingue 450 ml de 2 L', () => { expect(loteElegibleParaReceta({contenido_presentacion:450,cantidad_restante:2},{contenido_requerido:450,envases_completos:true},'pieza')).toBe(true); expect(loteElegibleParaReceta({contenido_presentacion:2000,cantidad_restante:2},{contenido_requerido:450,envases_completos:true},'pieza')).toBe(false); });
  it('un remanente fraccionado no se presenta como envase sellado completo', () => { expect(saldoEnvasesCompletos(2200,600,'ml')).toBe(1800); expect(saldoEnvasesCompletos(2.5,450,'pieza')).toBe(2); });
});
