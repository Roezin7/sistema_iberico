import { PrismaClient } from '@prisma/client';

/**
 * Corrección trazable para el arranque de la semana 65.
 *
 * - Materializa los 4 L de Squirt confirmados por el ticket histórico como
 *   existencia de apertura (sin tocar ni borrar el lote histórico cancelado).
 * - Publica únicamente la receta completa que existe en el Costeo Maestro:
 *   Montado Sevillano.
 *
 * Clericot, Cuba de Ron, Agua mineral independiente y la selección de tapas
 * no se inventan: el libro no contiene una receta operativa suficiente.
 */
const prisma = new PrismaClient();
const NEGOCIO = 1n;
const SEMANA = 65n;
const SQUIRT = 25n;
const TICKET_REF = 'APERTURA-FIFO-65-SQUIRT-4L';

async function main() {
  const resultado = await prisma.$transaction(async (tx) => {
    const semana = await tx.semanas.findFirst({
      where: { id: SEMANA, negocio_id: NEGOCIO },
      select: { id: true, fecha_inicio: true, inventario_semanal: { select: { apertura_snapshot_id: true, apertura_origen: true } } },
    });
    if (!semana?.inventario_semanal?.apertura_snapshot_id) throw new Error('Semana 65 no tiene apertura física enlazada');

    let lote = await tx.inventory_lots.findFirst({
      where: { negocio_id: NEGOCIO, ticket_ref: TICKET_REF },
      select: { id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, estado: true },
    });
    let loteCreado = false;
    if (!lote) {
      lote = await tx.inventory_lots.create({
        data: {
          negocio_id: NEGOCIO,
          product_id: SQUIRT,
          recibido_at: semana.fecha_inicio,
          cantidad_inicial: 4000,
          cantidad_restante: 4000,
          costo_unitario: 0.023,
          moneda: 'MXN',
          fuente: 'inventario_inicial',
          ticket_ref: TICKET_REF,
          notas: `Apertura FIFO semana 65; 4 L confirmados por ticket histórico HIST-63-LACOMER-23933753. Snapshot físico de apertura ${semana.inventario_semanal.apertura_snapshot_id}; se conserva el lote histórico cancelado como auditoría.`,
        },
        select: { id: true, cantidad_inicial: true, cantidad_restante: true, costo_unitario: true, estado: true },
      });
      loteCreado = true;
    }
    const origen = `${semana.inventario_semanal.apertura_origen ?? 'apertura'} · Squirt 4 L confirmado en lote ${lote.id.toString()}`;
    await tx.inventario_semanal.updateMany({ where: { negocio_id: NEGOCIO, semana_id: SEMANA }, data: { apertura_origen: origen } });

    const menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, nombre: 'Montado Sevillano (Quesos y Serrano)' }, select: { id: true, nombre: true } });
    if (!menu) throw new Error('No existe el producto de menú Montado Sevillano');
    const ultima = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { id: true, version: true, estado: true } });
    let receta = ultima;
    let recetaCreada = false;
    if (!ultima || ultima.estado !== 'validada') {
      const version = (ultima?.version ?? 0) + 1;
      receta = await tx.recetas.create({
        data: {
          producto_menu_id: menu.id,
          version,
          estado: 'validada',
          fuente: 'Costeo Maestro: IBERICO_FIFO_PILOTO_SEMANA_2026-08-10_16.xlsx · hoja 03_Recetas',
          notas: 'Receta recuperada del Costeo Maestro; miel Carlota 3 g. No se modifican recetas históricas.',
          lineas: { create: [
            { product_id: 47n, cantidad: 30, unidad: 'g', nota: 'Pan de cebolla/masa madre, pieza de 200 g' },
            { product_id: 44n, cantidad: 10, unidad: 'g', nota: 'Jamón serrano' },
            { product_id: 52n, cantidad: 5, unidad: 'g', nota: 'Queso mozzarella' },
            { product_id: 53n, cantidad: 5, unidad: 'g', nota: 'Queso gouda' },
            { product_id: 57n, cantidad: 5, unidad: 'g', nota: 'Queso manchego' },
            { product_id: 83n, cantidad: 3, unidad: 'g', nota: 'Miel Carlota' },
          ] },
        },
        select: { id: true, version: true, estado: true },
      });
      recetaCreada = true;
    }
    return {
      semana_id: Number(SEMANA),
      lote_squirt: { id: Number(lote.id), creado: loteCreado, cantidad_inicial: Number(lote.cantidad_inicial), cantidad_restante: Number(lote.cantidad_restante), costo_unitario: Number(lote.costo_unitario), estado: lote.estado },
      receta_montado_sevillano: { id: receta ? Number(receta.id) : null, version: receta?.version ?? null, creada: recetaCreada },
      recetas_sin_fuente_maestro: ['Agua mineral (producto independiente)', 'Clericot grande', 'Cuba de Ron', 'Tabla de Tapas Mixtas (selección de tres montados)'],
    };
  }, { maxWait: 60_000, timeout: 120_000 });
  console.log(JSON.stringify({ ok: true, ...resultado }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
