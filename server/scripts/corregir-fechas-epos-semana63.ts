import { PrismaClient } from '@prisma/client';

/**
 * Corrige sólo la importación histórica 2. Epos devolvió DateTime local sin
 * offset; el primer importador lo guardó como UTC y movió ventas del domingo
 * a la semana siguiente. No toca ventas de otras importaciones.
 */
const prisma = new PrismaClient();

function fechaLocal(raw: unknown) {
  if (typeof raw !== 'string' || !raw) return null;
  const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(tieneZona ? raw : `${raw}-06:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function main() {
  const rows = await prisma.epos_ventas.findMany({ where: { importacion_id: 2n }, select: { id: true, raw_json: true, fecha: true } });
  let actualizadas = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const parsed = row.raw_json ? JSON.parse(row.raw_json) as { DateTime?: string } : null;
      const fecha = fechaLocal(parsed?.DateTime);
      if (!fecha || fecha.getTime() === row.fecha.getTime()) continue;
      await tx.epos_ventas.update({ where: { id: row.id }, data: { fecha } });
      actualizadas += 1;
    }
  }, { timeout: 60_000 });
  console.log(JSON.stringify({ ok: true, importacion_id: 2, filas: rows.length, actualizadas }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
