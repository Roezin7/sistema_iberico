import { describe, expect, it } from 'vitest';
import { puedeEncolar, propietarioToken } from './offline-policy';
describe('cola segura por acción y propietario', () => {
  it.each([['PATCH','/tareas/resultados'],['POST','/inventario/compras/rapidas']])('permite %s %s', (m,p) => expect(puedeEncolar(m,p)).toBe(true));
  it.each([['POST','/inventario/snapshots'],['POST','/finanzas/arqueos'],['POST','/finanzas/semanas/75/cerrar'],['DELETE','/inventario/compras/rapidas'],['PATCH','/inventario/compras/rapidas/1']])('impide reproducir %s %s', (m,p) => expect(puedeEncolar(m,p)).toBe(false));
  it('separa usuarios y negocios incluso al renovar token', () => {
    const token = (sub:number,negocio:number) => 'header.'+btoa(JSON.stringify({sub:String(sub),negocio_id:String(negocio)}))+'.signature';
    expect(propietarioToken(token(1,1))).toBe('1:1');expect(propietarioToken(token(2,1))).toBe('1:2');expect(propietarioToken(token(1,2))).toBe('2:1');expect(propietarioToken('malformado')).toBeNull();
  });
});
