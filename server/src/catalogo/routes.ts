import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const catalogoRouter = Router();
catalogoRouter.use(requireAuth); // lecturas: cualquier usuario autenticado

// ---------------------------------------------------------------------------
//  NEGOCIO (parámetros generales)
// ---------------------------------------------------------------------------

catalogoRouter.get(
  '/negocio',
  asyncHandler(async (req, res) => {
    const n = await prisma.negocios.findUnique({ where: { id: req.auth!.negocioId } });
    if (!n) throw new HttpError(404, 'Negocio no encontrado');
    res.json({ id: Number(n.id), nombre: n.nombre, tipo: n.tipo, zona_horaria: n.zona_horaria });
  }),
);

catalogoRouter.patch(
  '/negocio',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ nombre: z.string().min(1).optional(), tipo: z.string().nullable().optional() }).parse(req.body);
    await prisma.negocios.update({ where: { id: req.auth!.negocioId }, data: { nombre: b.nombre, tipo: b.tipo === undefined ? undefined : b.tipo } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  PRODUCTOS
// ---------------------------------------------------------------------------

/** GET /catalogo/products — productos del negocio con tienda y unidades por zona. */
catalogoRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const productos = await prisma.products.findMany({
      where: { negocio_id: req.auth!.negocioId },
      include: { stores: true, product_zone_units: true },
      orderBy: { name: 'asc' },
    });
    res.json(
      productos.map((p) => ({
        id: Number(p.id),
        nombre: p.name,
        store_id: Number(p.store_id),
        store: p.stores.name,
        base_qty: num(p.base_qty),
        unit_cost: num(p.unit_cost),
        active: p.active,
        unidades: p.product_zone_units.map((u) => ({
          id: Number(u.id),
          zona_id: Number(u.zona_id),
          unidad_captura: u.unidad_captura,
          factor: num(u.factor),
        })),
      })),
    );
  }),
);

const productoBody = z.object({
  nombre: z.string().min(1),
  store_id: z.coerce.number().int().positive(),
  base_qty: z.coerce.number().min(0).default(0),
  unit_cost: z.coerce.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

/** POST /catalogo/products (admin) */
catalogoRouter.post(
  '/products',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = productoBody.parse(req.body);
    const creado = await prisma.products.create({
      data: {
        negocio_id: req.auth!.negocioId,
        name: b.nombre,
        store_id: BigInt(b.store_id),
        base_qty: b.base_qty,
        unit_cost: b.unit_cost ?? null,
        active: b.active ?? true,
      },
    });
    res.status(201).json({ id: Number(creado.id) });
  }),
);

/** PATCH /catalogo/products/:id (admin) — edita costo, par level, tienda, etc. */
catalogoRouter.patch(
  '/products/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
    const b = productoBody.partial().parse(req.body);
    const prod = await prisma.products.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!prod) throw new HttpError(404, 'Producto no encontrado');
    await prisma.products.update({
      where: { id },
      data: {
        name: b.nombre,
        store_id: b.store_id != null ? BigInt(b.store_id) : undefined,
        base_qty: b.base_qty,
        unit_cost: b.unit_cost === undefined ? undefined : b.unit_cost,
        active: b.active,
      },
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  STORES (tiendas / lugares de compra)
// ---------------------------------------------------------------------------

catalogoRouter.get(
  '/stores',
  asyncHandler(async (req, res) => {
    const stores = await prisma.stores.findMany({
      where: { negocio_id: req.auth!.negocioId },
      orderBy: { name: 'asc' },
    });
    res.json(stores.map((s) => ({ id: Number(s.id), nombre: s.name })));
  }),
);

catalogoRouter.post(
  '/stores',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const { nombre } = z.object({ nombre: z.string().min(1) }).parse(req.body);
    const s = await prisma.stores.create({ data: { negocio_id: req.auth!.negocioId, name: nombre } });
    res.status(201).json({ id: Number(s.id) });
  }),
);

// ---------------------------------------------------------------------------
//  ZONAS DE INVENTARIO
// ---------------------------------------------------------------------------

catalogoRouter.get(
  '/zonas',
  asyncHandler(async (req, res) => {
    const zonas = await prisma.zonas_inventario.findMany({
      where: { negocio_id: req.auth!.negocioId },
      orderBy: { orden: 'asc' },
    });
    res.json(zonas.map((z) => ({ id: Number(z.id), nombre: z.nombre, orden: z.orden })));
  }),
);

const zonaBody = z.object({ nombre: z.string().min(1), orden: z.coerce.number().int().default(0) });

catalogoRouter.post(
  '/zonas',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = zonaBody.parse(req.body);
    const z2 = await prisma.zonas_inventario.create({
      data: { negocio_id: req.auth!.negocioId, nombre: b.nombre, orden: b.orden },
    });
    res.status(201).json({ id: Number(z2.id) });
  }),
);

catalogoRouter.patch(
  '/zonas/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
    const b = zonaBody.partial().parse(req.body);
    const zona = await prisma.zonas_inventario.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!zona) throw new HttpError(404, 'Zona no encontrada');
    await prisma.zonas_inventario.update({ where: { id }, data: { nombre: b.nombre, orden: b.orden } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  PRODUCT-ZONE-UNITS (cómo se captura cada producto en cada zona)
// ---------------------------------------------------------------------------

const pzuBody = z.object({
  product_id: z.coerce.number().int().positive(),
  zona_id: z.coerce.number().int().positive(),
  unidad_captura: z.string().min(1),
  factor: z.coerce.number().positive(),
});

/** PUT /catalogo/product-zone-units — upsert por (product, zona). (admin) */
catalogoRouter.put(
  '/product-zone-units',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = pzuBody.parse(req.body);
    // Validar pertenencia al negocio.
    const [prod, zona] = await Promise.all([
      prisma.products.findFirst({ where: { id: BigInt(b.product_id), negocio_id: req.auth!.negocioId } }),
      prisma.zonas_inventario.findFirst({ where: { id: BigInt(b.zona_id), negocio_id: req.auth!.negocioId } }),
    ]);
    if (!prod || !zona) throw new HttpError(400, 'Producto o zona inválidos para este negocio');
    const r = await prisma.product_zone_units.upsert({
      where: { product_id_zona_id: { product_id: BigInt(b.product_id), zona_id: BigInt(b.zona_id) } },
      update: { unidad_captura: b.unidad_captura, factor: b.factor },
      create: {
        product_id: BigInt(b.product_id),
        zona_id: BigInt(b.zona_id),
        unidad_captura: b.unidad_captura,
        factor: b.factor,
      },
    });
    res.json({ id: Number(r.id) });
  }),
);

catalogoRouter.delete(
  '/product-zone-units/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
    // Asegurar que pertenece a un producto del negocio.
    const pzu = await prisma.product_zone_units.findUnique({ where: { id }, include: { products: true } });
    if (!pzu || pzu.products.negocio_id !== req.auth!.negocioId) throw new HttpError(404, 'No encontrado');
    await prisma.product_zone_units.delete({ where: { id } });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
//  ALIASES (matching para IA — Fase 7)
// ---------------------------------------------------------------------------

catalogoRouter.get(
  '/product-aliases',
  asyncHandler(async (req, res) => {
    const aliases = await prisma.product_aliases.findMany({
      where: { products: { negocio_id: req.auth!.negocioId } },
      orderBy: { alias: 'asc' },
    });
    res.json(aliases.map((a) => ({ id: Number(a.id), product_id: Number(a.product_id), alias: a.alias })));
  }),
);

catalogoRouter.post(
  '/product-aliases',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ product_id: z.coerce.number().int().positive(), alias: z.string().min(1) }).parse(req.body);
    const prod = await prisma.products.findFirst({ where: { id: BigInt(b.product_id), negocio_id: req.auth!.negocioId } });
    if (!prod) throw new HttpError(400, 'Producto inválido');
    const a = await prisma.product_aliases.create({ data: { product_id: BigInt(b.product_id), alias: b.alias } });
    res.status(201).json({ id: Number(a.id) });
  }),
);

catalogoRouter.delete(
  '/product-aliases/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
    const a = await prisma.product_aliases.findUnique({ where: { id }, include: { products: true } });
    if (!a || a.products.negocio_id !== req.auth!.negocioId) throw new HttpError(404, 'No encontrado');
    await prisma.product_aliases.delete({ where: { id } });
    res.status(204).end();
  }),
);
