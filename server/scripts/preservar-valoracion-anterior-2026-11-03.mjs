/** Reparación de referencias de costo, no de compras ni de conteos.
 * Recupera los metadatos anteriores de la bitácora inmutable de corrección.
 * Requiere migración historial_formato_costos y servidor compilado.
 * Dry-run por defecto; --apply registra dos vigencias por producto una sola vez.
 */
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ errorFormat: 'minimal' });
const APPLY = process.argv.includes('--apply');
try {
  const { registrarCambioCostoCatalogo } = await import(process.argv[1] === '-' ? './server/dist/inventario/costos-historicos.js' : '../dist/inventario/costos-historicos.js');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1120261103::bigint)`;
    for (const productId of [7n, 20n]) {
      const product = await tx.products.findUniqueOrThrow({ where: { id: productId } });
      const events = await tx.auditoria_eventos.findMany({ where: { negocio_id: 1n, entidad: 'inventory_lot', accion: 'corregir_presentacion_20261103' }, orderBy: { id: 'asc' } });
      const event = events.find(e => String(JSON.parse(e.antes).producto.id) === String(productId));
      if (!event || product.negocio_id !== 1n) throw Error('No existe evidencia anterior verificable');
      const old = JSON.parse(event.antes).producto;
      const previous = await tx.producto_costos_historicos.findFirst({ where: { product_id: productId, fuente: 'correccion_presentacion_20261103' } });
      console.log(JSON.stringify({ producto: product.name, existente: !!previous, antes: { costo: old.unit_cost, contenido: old.contenido_compra }, despues: { costo: product.unit_cost, contenido: product.contenido_compra }, vigente_desde: event.creado_at }));
      if (APPLY && !previous) await registrarCambioCostoCatalogo(tx, { ...old, id: productId }, product, event.creado_at, 'correccion_presentacion_20261103');
    }
  });
  console.log(APPLY ? 'Historial de formato/costo protegido, sin tocar cantidades ni cierres.' : 'Vista previa: no se guardó nada.');
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await db.$disconnect(); }
