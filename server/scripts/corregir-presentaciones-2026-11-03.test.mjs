import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { planificarSaldo } from './corregir-presentaciones-2026-11-03.mjs';
test('entrada intacta: 2 botellas de 700 ml conservan el importe', () => {
  const p = planificarSaldo(1500, 1500, 487.5, 1400, []);
  assert.deepEqual(p, { initial: 1400, remaining: 1400, cost: 0.348214, consumedUnchanged: 0, historicalCostUnchanged: 0, historicalCostDifference: 0 });
});
test('Jim Beam conserva 118.294 ml consumidos y revela diferencia de costo', () => {
  const p = planificarSaldo(1500, 1381.706, 878, 1400, [{ qty: 59.147, cost: 34.6207 }, { qty: 59.147, cost: 34.6207 }]);
  assert.equal(p.remaining, 1281.706); assert.equal(p.cost, 0.627143);
  assert.equal(p.consumedUnchanged, 118.294); assert.equal(p.historicalCostUnchanged, 69.2414);
  assert.equal(p.historicalCostDifference, 4.9458);
});
test('saldo ya corregido produce el mismo resultado', () => {
  const old = planificarSaldo(1500, 1381.706, 878, 1400, [{ qty: 118.294, cost: 69.2414 }]);
  assert.deepEqual(planificarSaldo(old.initial, old.remaining, 878, 1400, [{ qty: 118.294, cost: 69.2414 }]), old);
});
test('rechaza descuadre, saldo negativo, exceso de consumo y ajustes no soportados', () => {
  assert.throws(() => planificarSaldo(1500, 1380, 878, 1400, [{ qty: 118.294, cost: 69.24 }]));
  assert.throws(() => planificarSaldo(1500, -1, 878, 1400, []));
  assert.throws(() => planificarSaldo(1500, 0, 878, 1400, [{ qty: 1500, cost: 878 }]));
  assert.throws(() => planificarSaldo(1500, 1500, 878, 1400, [{ qty: -10, cost: 0 }]));
  assert.throws(() => planificarSaldo(NaN, 1500, 878, 1400, []));
});
