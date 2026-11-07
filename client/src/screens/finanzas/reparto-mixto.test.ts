import { describe, expect, it } from 'vitest';
import { repartoMixto } from './reparto-mixto';
describe('pagos parciales cash/card', () => {
  it('reparte $300 en $100 efectivo y $200 tarjeta', () => expect(repartoMixto(300,'100','200')).toEqual({efectivo:100,tarjeta:200}));
  it.each([['','300'],['100',''],['100','190'],['-5','305'],['NaN','300']])('no confirma un reparto incompleto %s/%s', (a,b) => expect(repartoMixto(300,a,b)).toBeNull());
  it('acepta cero explícito y el total con un solo método si así se confirmó', () => expect(repartoMixto(300,'0','300')).toEqual({efectivo:0,tarjeta:300}));
});
