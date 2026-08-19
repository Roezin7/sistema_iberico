import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const recetasRouter = Router();
recetasRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const linea = z.object({
  product_id: id,
  cantidad: z.coerce.number().positive(),
  unidad: z.string().min(1).max(30),
  nota: z.string().max(250).nullable().optional(),
});

const recetaBody = z.object({
  producto_menu_id: id.nullable().optional(),
  nombre: z.string().min(1).max(150),
  epos_product_id: z.coerce.number().int().positive().nullable().optional(),
  precio_venta: z.coerce.number().min(0).nullable().optional(),
  estado: z.enum(['borrador', 'validada', 'retirada']).default('borrador'),
  fuente: z.string().max(500).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  vigente_desde: z.string().date().nullable().optional(),
  lineas: z.array(linea).default([]),
});

function serialize(p: any) {
  return {
    id: Number(p.id),
    nombre: p.nombre,
    epos_product_id: p.epos_product_id,
    precio_venta: num(p.precio_venta),
    activo: p.activo,
    recetas: (p.recetas ?? []).map((r: any) => ({
      id: Number(r.id),
      version: r.version,
      estado: r.estado,
      fuente: r.fuente,
      notas: r.notas,
      vigente_desde: r.vigente_desde,
      creado_at: r.creado_at,
      lineas: (r.lineas ?? []).map((l: any) => {
        const costoUnitario = l.products?.unit_cost == null ? null : num(l.products.unit_cost);
        const cantidad = num(l.cantidad) ?? 0;
        return {
          product_id: Number(l.product_id),
          producto: l.products?.name ?? null,
          cantidad,
          unidad: l.unidad,
          nota: l.nota,
          costo_unitario: costoUnitario,
          costo_estimado: costoUnitario == null ? null : cantidad * costoUnitario,
        };
      }),
    })),
  };
}

/** GET /recetas — menú, versiones y líneas; solo datos del negocio autenticado. */
recetasRouter.get('/', asyncHandler(async (req, res) => {
  const productos = await prisma.productos_menu.findMany({
    where: { negocio_id: req.auth!.negocioId },
    include: {
      recetas: {
        orderBy: { version: 'desc' },
        include: { lineas: { include: { products: { select: { name: true, unit_cost: true } } } } },
      },
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
  });
  res.json(productos.map(serialize));
}));

/** GET /recetas/insumos — catálogo disponible para construir líneas. */
recetasRouter.get('/insumos', asyncHandler(async (req, res) => {
  const productos = await prisma.products.findMany({
    where: { negocio_id: req.auth!.negocioId, active: true },
    select: { id: true, name: true, unit_cost: true },
    orderBy: { name: 'asc' },
  });
  res.json(productos.map((p) => ({ id: Number(p.id), nombre: p.name, costo_unitario: num(p.unit_cost) })));
}));

/** POST /recetas — crea producto de menú y una nueva versión de receta. */
recetasRouter.post('/', soloAdmin, asyncHandler(async (req, res) => {
  const b = recetaBody.parse(req.body);
  const negocioId = req.auth!.negocioId;
  const ids = [...new Set(b.lineas.map((l) => l.product_id))];
  const insumos = await prisma.products.findMany({ where: { id: { in: ids.map(BigInt) }, negocio_id: negocioId, active: true }, select: { id: true } });
  if (insumos.length !== ids.length) throw new HttpError(400, 'Una o más líneas no pertenecen al catálogo activo de Ibérico.');

  const producto = await prisma.$transaction(async (tx) => {
    let menu = b.producto_menu_id == null
      ? await tx.productos_menu.findFirst({ where: { negocio_id: negocioId, nombre: b.nombre } })
      : await tx.productos_menu.findFirst({ where: { id: BigInt(b.producto_menu_id), negocio_id: negocioId } });
    if (!menu) {
      menu = await tx.productos_menu.create({ data: {
        negocio_id: negocioId,
        nombre: b.nombre,
        epos_product_id: b.epos_product_id ?? null,
        precio_venta: b.precio_venta ?? null,
      } });
    } else {
      menu = await tx.productos_menu.update({ where: { id: menu.id }, data: {
        nombre: b.nombre,
        epos_product_id: b.epos_product_id === undefined ? undefined : b.epos_product_id,
        precio_venta: b.precio_venta === undefined ? undefined : b.precio_venta,
      } });
    }
    const ultima = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const receta = await tx.recetas.create({ data: {
      producto_menu_id: menu.id,
      version: (ultima?.version ?? 0) + 1,
      estado: b.estado,
      fuente: b.fuente ?? null,
      notas: b.notas ?? null,
      vigente_desde: b.vigente_desde ? new Date(`${b.vigente_desde}T00:00:00.000Z`) : null,
      lineas: { create: b.lineas.map((l) => ({ product_id: BigInt(l.product_id), cantidad: l.cantidad, unidad: l.unidad, nota: l.nota ?? null })) },
    } });
    return { menu, receta };
  });
  res.status(201).json({ id: Number(producto.menu.id), receta_id: Number(producto.receta.id), version: producto.receta.version });
}));

/** PATCH /recetas/:id/estado — retira/reactiva una receta sin borrar historia. */
recetasRouter.patch('/:id/estado', soloAdmin, asyncHandler(async (req, res) => {
  const recetaId = BigInt(id.parse(req.params.id));
  const { estado } = z.object({ estado: z.enum(['borrador', 'validada', 'retirada']) }).parse(req.body);
  const receta = await prisma.recetas.findFirst({ where: { id: recetaId, productos_menu: { negocio_id: req.auth!.negocioId } } });
  if (!receta) throw new HttpError(404, 'Receta no encontrada');
  await prisma.recetas.update({ where: { id: recetaId }, data: { estado } });
  res.json({ ok: true });
}));
