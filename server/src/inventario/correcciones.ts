import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { num0 } from '../lib/num.js';

function costoUnitarioBase(producto: { unit_cost: unknown; unidad_base?: string | null; contenido_compra?: unknown }) {
  const costo = producto.unit_cost == null ? null : Number(producto.unit_cost);
  const contenido = producto.contenido_compra == null ? null : Number(producto.contenido_compra);
  return costo == null ? null : producto.unidad_base && contenido != null && contenido > 0 ? costo / contenido : costo;
}

function redondear(n: number, decimales = 4) {
  const factor = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function isoFecha(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function referenciasCorreccion(negocioId: bigint) {
  const [productos, zonas, unidades] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, active: true },
      select: { id: true, name: true, unidad_base: true, unit_cost: true },
      orderBy: { name: 'asc' },
    }),
    prisma.zonas_inventario.findMany({ where: { negocio_id: negocioId }, select: { id: true, nombre: true }, orderBy: { orden: 'asc' } }),
    prisma.product_zone_units.findMany({ where: { products: { negocio_id: negocioId } }, select: { product_id: true, zona_id: true, unidad_captura: true, factor: true } }),
  ]);
  const unidadMap = new Map(unidades.map((u) => [`${u.product_id}:${u.zona_id}`, u]));
  return {
    zonas: zonas.map((z) => ({ id: Number(z.id), nombre: z.nombre })),
    productos: productos.map((p) => ({
      id: Number(p.id),
      nombre: p.name,
      unidad_base: p.unidad_base,
      costo: p.unit_cost == null ? null : num0(p.unit_cost),
      unidades: zonas.map((z) => {
        const u = unidadMap.get(`${p.id}:${z.id}`);
        return { zona_id: Number(z.id), unidad_captura: u?.unidad_captura ?? p.unidad_base ?? 'unidad base', factor: u ? num0(u.factor) : 1 };
      }),
    })),
  };
}

export async function listarCorrecciones(negocioId: bigint, semanaId: bigint) {
  const rows = await prisma.inventory_adjustments.findMany({
    where: { negocio_id: negocioId, semana_id: semanaId },
    include: { products: { select: { name: true, unidad_base: true } }, zonas_inventario: { select: { nombre: true } }, usuario: { select: { nombre: true } } },
    orderBy: [{ creado_at: 'desc' }, { id: 'desc' }],
  });
  const unidades = rows.length ? await prisma.product_zone_units.findMany({ where: { product_id: { in: rows.map((r) => r.product_id) }, zona_id: { in: rows.map((r) => r.zona_id) } }, select: { product_id: true, zona_id: true, unidad_captura: true } }) : [];
  const unidadMap = new Map(unidades.map((u) => [`${u.product_id}:${u.zona_id}`, u.unidad_captura]));
  return rows.map((r) => ({
    id: Number(r.id), product_id: Number(r.product_id), producto: r.products.name,
    unidad_base: r.products.unidad_base, unidad_captura: unidadMap.get(`${r.product_id}:${r.zona_id}`) ?? r.products.unidad_base ?? 'unidad base', zona_id: Number(r.zona_id), zona: r.zonas_inventario.nombre,
    cantidad_base: num0(r.cantidad_base), cantidad_captura: num0(r.cantidad_captura), factor: num0(r.factor),
    costo_unitario: num0(r.costo_unitario), motivo: r.motivo, nota: r.nota, usuario: r.usuario.nombre,
    creado_at: r.creado_at.toISOString(), snapshot_anterior_id: Number(r.snapshot_anterior_id), snapshot_nuevo_id: Number(r.snapshot_nuevo_id),
  }));
}

type AjusteInput = {
  negocioId: bigint; usuarioId: bigint; semanaId: bigint; productId: bigint; zonaId: bigint;
  cantidadBase: number; motivo: string; nota?: string | null; solicitudId?: string | null;
};

async function valorSnapshotTx(tx: Prisma.TransactionClient, snapshotId: bigint) {
  const lineas = await tx.inventory_lines.findMany({ where: { snapshot_id: snapshotId }, include: { products: { select: { unit_cost: true, unidad_base: true, contenido_compra: true } } } });
  return Math.round(lineas.reduce((total, l) => {
    const costo = costoUnitarioBase(l.products) ?? 0;
    return total + num0(l.qty_captura) * num0(l.factor) * costo;
  }, 0) * 100) / 100;
}

/**
 * Corrige el cierre físico de una semana sin editar snapshots históricos.
 * Positivos crean un lote FIFO de ajuste; negativos consumen FIFO siguiendo
 * el orden de recepción. La siguiente semana sólo se encadena si permanece abierta.
 */
export async function crearCorreccionInventario(input: AjusteInput) {
  const cantidadBase = redondear(Number(input.cantidadBase));
  if (!Number.isFinite(cantidadBase) || cantidadBase === 0) throw new HttpError(400, 'La corrección debe ser distinta de cero');
  if (!input.motivo.trim()) throw new HttpError(400, 'El motivo es obligatorio');

  return prisma.$transaction(async (tx) => {
    if (input.solicitudId) {
      const existente = await tx.inventory_adjustments.findFirst({ where: { negocio_id: input.negocioId, solicitud_id: input.solicitudId } });
      if (existente) return { id: Number(existente.id), repetida: true, ...await serializarAjuste(tx, existente.id) };
    }

    const semanal = await tx.inventario_semanal.findUnique({ where: { semana_id: input.semanaId } });
    if (!semanal?.cierre_snapshot_id) throw new HttpError(409, 'La semana debe tener un cierre físico para aplicar una corrección.');
    const semana = await tx.semanas.findFirst({ where: { id: input.semanaId, negocio_id: input.negocioId } });
    if (!semana) throw new HttpError(404, 'Semana no encontrada');

    const siguiente = await tx.semanas.findFirst({
      where: { negocio_id: input.negocioId, fecha_inicio: { gt: semana.fecha_inicio } },
      orderBy: { fecha_inicio: 'asc' }, include: { inventario_semanal: true },
    });
    if (siguiente?.estado === 'cerrada' && siguiente.inventario_semanal?.apertura_snapshot_id === semanal.cierre_snapshot_id) {
      throw new HttpError(409, 'La semana siguiente ya está cerrada. Reábrela antes de corregir este cierre para no romper la cadena de inventario.');
    }

    const [producto, zona, pzu, lineas] = await Promise.all([
      tx.products.findFirst({ where: { id: input.productId, negocio_id: input.negocioId, active: true }, select: { id: true, name: true, unit_cost: true, unidad_base: true } }),
      tx.zonas_inventario.findFirst({ where: { id: input.zonaId, negocio_id: input.negocioId }, select: { id: true, nombre: true } }),
      tx.product_zone_units.findUnique({ where: { product_id_zona_id: { product_id: input.productId, zona_id: input.zonaId } }, select: { unidad_captura: true, factor: true } }),
      tx.inventory_lines.findMany({ where: { snapshot_id: semanal.cierre_snapshot_id }, select: { product_id: true, zona_id: true, qty_captura: true, factor: true } }),
    ]);
    if (!producto) throw new HttpError(404, 'Producto no encontrado');
    if (!zona) throw new HttpError(404, 'Zona no encontrada');
    const existente = lineas.find((l) => l.product_id === input.productId && l.zona_id === input.zonaId);
    const factor = existente ? num0(existente.factor) : (pzu ? num0(pzu.factor) : 1);
    if (!factor || factor <= 0) throw new HttpError(409, 'El factor de captura del producto no es válido');
    const deltaCaptura = redondear(cantidadBase / factor);
    const qtyActual = existente ? num0(existente.qty_captura) : 0;
    if (qtyActual + deltaCaptura < -0.0001) throw new HttpError(409, 'La corrección dejaría inventario físico negativo en esa zona');

    let costo = producto.unit_cost == null ? null : num0(producto.unit_cost);
    if (costo == null) {
      const ultimo = await tx.inventory_lots.findFirst({ where: { negocio_id: input.negocioId, product_id: input.productId }, orderBy: [{ recibido_at: 'desc' }, { id: 'desc' }], select: { costo_unitario: true } });
      costo = ultimo ? num0(ultimo.costo_unitario) : null;
    }
    if (costo == null) throw new HttpError(409, 'El producto no tiene costo para valorar la corrección');

    const nuevo = await tx.inventory_snapshot.create({ data: { negocio_id: input.negocioId } });
    const nuevasLineas: { snapshot_id: bigint; product_id: bigint; zona_id: bigint; qty_captura: number; factor: number }[] = lineas.map((l) => ({ snapshot_id: nuevo.id, product_id: l.product_id, zona_id: l.zona_id, qty_captura: l.product_id === input.productId && l.zona_id === input.zonaId ? redondear(num0(l.qty_captura) + deltaCaptura) : num0(l.qty_captura), factor: num0(l.factor) }));
    if (!existente && cantidadBase > 0) nuevasLineas.push({ snapshot_id: nuevo.id, product_id: input.productId, zona_id: input.zonaId, qty_captura: deltaCaptura, factor });
    if (nuevasLineas.length) await tx.inventory_lines.createMany({ data: nuevasLineas });
    const nuevoValor = await valorSnapshotTx(tx, nuevo.id);

    const ajuste = await tx.inventory_adjustments.create({ data: {
      negocio_id: input.negocioId, semana_id: input.semanaId, product_id: input.productId, zona_id: input.zonaId,
      cantidad_base: cantidadBase, factor, cantidad_captura: deltaCaptura, costo_unitario: costo,
      motivo: input.motivo.trim(), nota: input.nota?.trim() || null, solicitud_id: input.solicitudId || null,
      snapshot_anterior_id: semanal.cierre_snapshot_id, snapshot_nuevo_id: nuevo.id, usuario_id: input.usuarioId,
    } });

    if (cantidadBase > 0) {
      await tx.inventory_lots.create({ data: {
        negocio_id: input.negocioId, product_id: input.productId, recibido_at: semana.fecha_fin,
        cantidad_inicial: cantidadBase, cantidad_restante: cantidadBase, costo_unitario: costo,
        fuente: 'ajuste_inventario', ticket_ref: `AJUSTE-INVENTARIO-${input.semanaId}-${ajuste.id}`,
        notas: input.motivo.trim(),
      } });
    } else {
      let pendiente = Math.abs(cantidadBase);
      const lotes = await tx.inventory_lots.findMany({ where: { negocio_id: input.negocioId, product_id: input.productId, cantidad_restante: { gt: 0 } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }] });
      const disponible = lotes.reduce((a, l) => a + num0(l.cantidad_restante), 0);
      if (disponible + 0.0001 < pendiente) throw new HttpError(409, 'No hay suficiente existencia FIFO para registrar una corrección negativa');
      for (const lote of lotes) {
        if (pendiente <= 0) break;
        const consumir = Math.min(pendiente, num0(lote.cantidad_restante));
        await tx.inventory_consumptions.create({ data: {
          negocio_id: input.negocioId, product_id: input.productId, lote_id: lote.id, fecha: semana.fecha_fin,
          cantidad: consumir, costo_unitario: lote.costo_unitario, costo_total: consumir * num0(lote.costo_unitario), fuente: 'ajuste_inventario',
        } });
        const restante = num0(lote.cantidad_restante) - consumir;
        await tx.inventory_lots.update({ where: { id: lote.id }, data: { cantidad_restante: restante, estado: restante <= 0 ? 'agotado' : 'abierto' } });
        pendiente = redondear(pendiente - consumir);
      }
    }

    await tx.inventario_semanal.update({ where: { semana_id: input.semanaId }, data: { cierre_snapshot_id: nuevo.id, cierre_valor: nuevoValor } });
    if (siguiente?.estado === 'abierta' && siguiente.inventario_semanal?.apertura_snapshot_id === semanal.cierre_snapshot_id) {
      await tx.inventario_semanal.update({ where: { semana_id: siguiente.id }, data: { apertura_snapshot_id: nuevo.id, apertura_valor: nuevoValor, apertura_origen: 'correccion_cierre_semana_anterior' } });
    }
    return { id: Number(ajuste.id), repetida: false, ...(await serializarAjuste(tx, ajuste.id)), nuevo_valor_cierre: nuevoValor };
  }, { timeout: 20000, maxWait: 15000 });
}

async function serializarAjuste(tx: Prisma.TransactionClient, id: bigint) {
  const r = await tx.inventory_adjustments.findUniqueOrThrow({ where: { id }, include: { products: { select: { name: true, unidad_base: true } }, zonas_inventario: { select: { nombre: true } }, usuario: { select: { nombre: true } } } });
  const unidad = await tx.product_zone_units.findUnique({ where: { product_id_zona_id: { product_id: r.product_id, zona_id: r.zona_id } }, select: { unidad_captura: true } });
  return { producto: r.products.name, unidad_base: r.products.unidad_base, unidad_captura: unidad?.unidad_captura ?? r.products.unidad_base ?? 'unidad base', zona: r.zonas_inventario.nombre, cantidad_base: num0(r.cantidad_base), cantidad_captura: num0(r.cantidad_captura), motivo: r.motivo, nota: r.nota, usuario: r.usuario.nombre, creado_at: r.creado_at.toISOString() };
}
