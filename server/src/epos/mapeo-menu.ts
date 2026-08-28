import { prisma } from '../db.js';

export function normalizarNombreEpos(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”"'`´]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

type VentaMap = { nombre: string; epos_product_id: number | null; cantidad: number; ventas: number };

export async function auditarMapeoEpos(input: { negocioId: bigint; from?: Date; to?: Date }) {
  const [ventas, menu] = await Promise.all([
    prisma.epos_ventas.findMany({
      where: { negocio_id: input.negocioId, ...(input.from || input.to ? { fecha: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } } : {}) },
      select: { producto_nombre: true, epos_product_id: true, cantidad: true, venta_bruta: true },
    }),
    prisma.productos_menu.findMany({ where: { negocio_id: input.negocioId, activo: true }, select: { id: true, nombre: true, epos_product_id: true } }),
  ]);
  const byId = new Map(menu.filter((m) => m.epos_product_id != null).map((m) => [m.epos_product_id!, m]));
  const byName = new Map(menu.map((m) => [normalizarNombreEpos(m.nombre), m]));
  const grouped = new Map<string, VentaMap>();
  for (const venta of ventas) {
    const key = `${venta.epos_product_id ?? 'nombre'}:${normalizarNombreEpos(venta.producto_nombre)}`;
    const prev = grouped.get(key);
    if (prev) { prev.cantidad += Number(venta.cantidad); prev.ventas += Number(venta.venta_bruta); }
    else grouped.set(key, { nombre: venta.producto_nombre, epos_product_id: venta.epos_product_id, cantidad: Number(venta.cantidad), ventas: Number(venta.venta_bruta) });
  }
  return [...grouped.values()].map((venta) => {
    const candidato = (venta.epos_product_id == null ? null : byId.get(venta.epos_product_id)) ?? byName.get(normalizarNombreEpos(venta.nombre)) ?? null;
    return {
      ...venta,
      menu_id: candidato ? Number(candidato.id) : null,
      menu_nombre: candidato?.nombre ?? null,
      menu_epos_product_id: candidato?.epos_product_id ?? null,
      estado: candidato ? 'mapeado' as const : 'sin_mapeo' as const,
    };
  }).sort((a, b) => a.estado.localeCompare(b.estado) || a.nombre.localeCompare(b.nombre));
}

/** Persiste sólo asociaciones Epos por ID que tienen coincidencia de nombre
 * determinística; los productos sin ProductID siguen resolviéndose por nombre. */
export async function aplicarMapeoEpos(input: { negocioId: bigint; from?: Date; to?: Date }) {
  const propuestas = await auditarMapeoEpos(input);
  const aplicadas: { menu_id: number; epos_product_id: number }[] = [];
  for (const p of propuestas) {
    if (p.estado !== 'mapeado' || p.epos_product_id == null || p.menu_id == null) continue;
    if (p.menu_epos_product_id != null && p.menu_epos_product_id !== p.epos_product_id) continue;
    const ocupado = await prisma.productos_menu.findFirst({
      where: { negocio_id: input.negocioId, epos_product_id: p.epos_product_id, id: { not: BigInt(p.menu_id) } },
      select: { id: true },
    });
    if (ocupado) continue;
    const updated = await prisma.productos_menu.updateMany({
      where: { id: BigInt(p.menu_id), negocio_id: input.negocioId, activo: true },
      data: { epos_product_id: p.epos_product_id },
    });
    if (updated.count === 1) aplicadas.push({ menu_id: p.menu_id, epos_product_id: p.epos_product_id });
  }
  return { propuestas, aplicadas };
}
