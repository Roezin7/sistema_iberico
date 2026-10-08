/** Actualiza costos y rendimiento de insumos confirmados, sin registrar compras. */
import { prisma } from '../src/db.js';

const NEGOCIO_ID = 1n;
const APPLY = process.argv.includes('--apply');

const INSUMOS = [
  {
    nombre: 'Nuez de la India',
    unit_cost: 379,
    unidad_base: 'g',
    contenido_compra: 1100,
    unidad_compra: 'bolsa',
    rendimiento_util: 1,
    fuente: 'Kirkland Signature, Costco; bolsa de 1.1 kg por $379',
  },
  {
    nombre: 'Chicharrón de habanero',
    unit_cost: 17,
    unidad_base: 'g',
    contenido_compra: 20,
    unidad_compra: 'porción cruda',
    rendimiento_util: 0.5,
    fuente: 'Producción interna; 20 g crudos por $17 rinden 10 g secos',
  },
];

async function main() {
  const rows = await prisma.products.findMany({ where: { negocio_id: NEGOCIO_ID, name: { in: INSUMOS.map((i) => i.nombre) } }, select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true, unidad_compra: true, rendimiento_util: true } });
  const byName = new Map(rows.map((row) => [row.name, row]));
  const missing = INSUMOS.filter((item) => !byName.has(item.nombre));
  if (missing.length) throw new Error(`Insumos no encontrados: ${missing.map((item) => item.nombre).join(', ')}`);

  const cambios = INSUMOS.map((item) => {
    const current = byName.get(item.nombre)!;
    return {
      id: Number(current.id), nombre: item.nombre,
      antes: { unit_cost: current.unit_cost?.toString() ?? null, unidad_base: current.unidad_base, contenido_compra: current.contenido_compra?.toString() ?? null, unidad_compra: current.unidad_compra, rendimiento_util: current.rendimiento_util?.toString() ?? null },
      despues: { unit_cost: item.unit_cost, unidad_base: item.unidad_base, contenido_compra: item.contenido_compra, unidad_compra: item.unidad_compra, rendimiento_util: item.rendimiento_util },
      fuente: item.fuente,
    };
  });
  console.log(JSON.stringify({ modo: APPLY ? 'apply' : 'dry-run', cambios }, null, 2));
  if (!APPLY) return;

  await prisma.$transaction(INSUMOS.map((item) => prisma.products.update({
    where: { id: byName.get(item.nombre)!.id },
    data: { unit_cost: item.unit_cost, unidad_base: item.unidad_base, contenido_compra: item.contenido_compra, unidad_compra: item.unidad_compra, rendimiento_util: item.rendimiento_util },
  })));

  console.log(JSON.stringify({ actualizado: INSUMOS.map((item) => ({ nombre: item.nombre, costo_unitario_compra: item.unit_cost, contenido_compra: item.contenido_compra, rendimiento_util: item.rendimiento_util })) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
