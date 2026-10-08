import { prisma } from '../src/db.js';
import { costearVentasPendientesEnVivo } from '../src/inventario/consumo-epos.js';
import { listarExcepcionesCosteoSemana, persistirConciliacionInventarioSemana } from '../src/finanzas/service.js';

const NEGOCIO_ID = 1n;
const SEMANA_67 = 67n;
const TICKET_AGUA = 'AJUSTE-CONTEO-ERROR-W67-AGUA-2026-10-07';
const TICKET_JAMON = 'AJUSTE-CONTEO-ERROR-W67-JAMON-2026-10-07';

async function main() {
  const semana = await prisma.semanas.findFirstOrThrow({ where: { id: SEMANA_67, negocio_id: NEGOCIO_ID }, select: { fecha_inicio: true } });
  const [agua, jamon, cecina] = await Promise.all([
    prisma.products.findFirstOrThrow({ where: { negocio_id: NEGOCIO_ID, name: 'Agua natural' }, select: { id: true, unit_cost: true, contenido_compra: true } }),
    prisma.products.findFirstOrThrow({ where: { negocio_id: NEGOCIO_ID, name: 'Jamon Serrano' }, select: { id: true, unit_cost: true, contenido_compra: true } }),
    prisma.products.findFirstOrThrow({ where: { negocio_id: NEGOCIO_ID, name: 'Cecina' }, select: { id: true } }),
  ]);

  await prisma.$transaction(async (tx) => {
    const ajustes = [
      { product: agua, qty: 500, ticket: TICKET_AGUA, motivo: 'Error de conteo confirmado por usuario en semana 67: faltaban 100 ml de Agua natural en 5 ventas históricas.', unit: 'ml' },
      { product: jamon, qty: 60, ticket: TICKET_JAMON, motivo: 'Error de cantidad confirmado por usuario en semana 67: faltaban 20 g de Jamón Serrano en 3 ventas históricas.', unit: 'g' },
    ];
    for (const ajuste of ajustes) {
      const exists = await tx.inventory_lots.findFirst({ where: { negocio_id: NEGOCIO_ID, ticket_ref: ajuste.ticket }, select: { id: true } });
      if (exists) continue;
      const costo = Number(ajuste.product.unit_cost ?? 0) / Number(ajuste.product.contenido_compra ?? 1);
      await tx.inventory_lots.create({ data: {
        negocio_id: NEGOCIO_ID,
        product_id: ajuste.product.id,
        purchase_id: null,
        recibido_at: semana.fecha_inicio,
        cantidad_inicial: ajuste.qty,
        cantidad_restante: ajuste.qty,
        costo_unitario: costo,
        moneda: 'MXN',
        estado: 'abierto',
        fuente: 'ajuste_inventario',
        ticket_ref: ajuste.ticket,
        notas: `${ajuste.motivo} No es compra y no afecta Banco. Unidad base: ${ajuste.unit}.`,
      } });
    }

    await tx.products.update({
      where: { id: cecina.id },
      data: { unit_cost: 58, unidad_base: 'g', contenido_compra: 50, unidad_compra: 'bolsa' },
    });
    const menu = await tx.productos_menu.findFirstOrThrow({ where: { negocio_id: NEGOCIO_ID, nombre: 'Cecina' }, select: { id: true } });
    const receta = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id, version: 1 }, select: { id: true } });
    const recetaId = receta
      ? receta.id
      : (await tx.recetas.create({ data: { producto_menu_id: menu.id, version: 1, estado: 'borrador' }, select: { id: true } })).id;
    await tx.recetas.update({ where: { id: recetaId }, data: {
      estado: 'validada',
      fuente: 'confirmacion_usuario_2026-10-07',
      notas: 'Cecina: 1 bolsa = 50 g por venta; costo confirmado $58 por bolsa.',
    } });
    await tx.receta_lineas.upsert({
      where: { receta_id_product_id: { receta_id: recetaId, product_id: cecina.id } },
      create: { receta_id: recetaId, product_id: cecina.id, cantidad: 50, unidad: 'g', nota: '1 bolsa por venta (50 g).' },
      update: { cantidad: 50, unidad: 'g', nota: '1 bolsa por venta (50 g).' },
    });
  }, { timeout: 20000, maxWait: 15000 });

  let costeo;
  try {
    costeo = await costearVentasPendientesEnVivo({ negocioId: NEGOCIO_ID });
  } catch (error) {
    console.error('Costeo global no pudo completar:', error);
  }
  await persistirConciliacionInventarioSemana(NEGOCIO_ID, 67n);
  await persistirConciliacionInventarioSemana(NEGOCIO_ID, 68n);
  console.log('costeo', costeo ?? null);
  console.log('semana67', JSON.stringify(await listarExcepcionesCosteoSemana(NEGOCIO_ID, 67n)));
  console.log('semana68', JSON.stringify(await listarExcepcionesCosteoSemana(NEGOCIO_ID, 68n)));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
