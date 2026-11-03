/** Ensayo con rollback obligatorio; rechaza una base que no sea local audit/test. */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { registrarCambioCostoCatalogo, valorSnapshotHistorico } from '../dist/inventario/costos-historicos.js';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://missing/');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && /audit|test/.test(url.pathname), 'Sólo una copia local audit/test');
const db = new PrismaClient();
const rollback = new Error('QA_ROLLBACK_OBLIGATORIO');
try {
  try {
    await db.$transaction(async tx => {
      const p = await tx.products.findUniqueOrThrow({ where: { id: 20n } });
      assert.equal(p.negocio_id, 1n);
      const t = new Date();
      const before = await tx.inventory_snapshot.create({ data: { negocio_id: 1n, created_at: new Date(t.getTime() - 1000), tipo: 'qa_sin_efecto' } });
      await tx.inventory_lines.create({ data: { snapshot_id: before.id, product_id: p.id, zona_id: 1n, qty_captura: 700, factor: 1 } });
      const expected = await valorSnapshotHistorico(tx, 1n, before.id);
      const changed = await tx.products.update({ where: { id: p.id }, data: { unit_cost: 600, contenido_compra: 1000 } });
      await registrarCambioCostoCatalogo(tx, p, changed, t, 'qa_rollback');
      assert.equal(await valorSnapshotHistorico(tx, 1n, before.id), expected, 'No revaluar un conteo previo del mismo día');
      const after = await tx.inventory_snapshot.create({ data: { negocio_id: 1n, created_at: new Date(t.getTime() + 100), tipo: 'qa_sin_efecto' } });
      await tx.inventory_lines.create({ data: { snapshot_id: after.id, product_id: p.id, zona_id: 1n, qty_captura: 700, factor: 1 } });
      assert.equal(await valorSnapshotHistorico(tx, 1n, after.id), 420);
      assert.equal(await valorSnapshotHistorico(tx, 9999n, after.id), 0, 'Aislamiento por negocio');
      console.log(JSON.stringify({ ok: true, snapshot_anterior_sin_cambios: expected, snapshot_posterior: 420, aislamiento_negocio: true, rollback: 'obligatorio' }));
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
  console.log('Transacción de prueba revertida íntegramente.');
} finally { await db.$disconnect(); }
