import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { inventarioActual, listaCompras, crearConteo } from './service.js';
import { borradorConteo, draftDisponible } from './draft.js';
import { listarLotes, registrarCompra } from './compras.js';

export const inventarioRouter = Router();

// Inventario y tareas son accesibles para admin y empleado.
inventarioRouter.use(requireAuth);

/** GET /inventario/current — total base por producto + valor de inventario. */
inventarioRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    res.json(await inventarioActual(req.auth!.negocioId));
  }),
);

/** GET /inventario/shopping-list — faltantes agrupados por tienda. */
inventarioRouter.get(
  '/shopping-list',
  asyncHandler(async (req, res) => {
    res.json(await listaCompras(req.auth!.negocioId));
  }),
);

const conteoSchema = z.object({
  lineas: z
    .array(
      z.object({
        product_id: z.coerce.number().int().positive(),
        zona_id: z.coerce.number().int().positive(),
        qty_captura: z.coerce.number().min(0),
      }),
    )
    .min(1),
});

/** POST /inventario/snapshots — crea un conteo nuevo con líneas por zona. */
inventarioRouter.post(
  '/snapshots',
  asyncHandler(async (req, res) => {
    const { lineas } = conteoSchema.parse(req.body);
    const r = await crearConteo(req.auth!.negocioId, lineas);
    res.status(201).json(r);
  }),
);

/** GET /inventario/lotes — libro FIFO para revisión; no modifica existencias. */
inventarioRouter.get(
  '/lotes',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const productId = req.query.product_id ? BigInt(z.coerce.number().int().positive().parse(req.query.product_id)) : undefined;
    res.json(await listarLotes(req.auth!.negocioId, productId));
  }),
);

/** POST /inventario/compras — registra compra revisada y crea lotes FIFO. */
inventarioRouter.post(
  '/compras',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({
      confirmada: z.literal(true),
      fecha_recepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      proveedor: z.string().trim().min(1).optional().nullable(),
      ticket_ref: z.string().trim().min(1).optional().nullable(),
      total: z.coerce.number().nonnegative().optional().nullable(),
      moneda: z.string().trim().min(1).max(8).default('MXN'),
      fuente: z.string().trim().min(1).max(40).default('manual'),
      notas: z.string().trim().max(1000).optional().nullable(),
      lineas: z.array(z.object({
        product_id: z.coerce.number().int().positive(),
        cantidad_base: z.coerce.number().positive(),
        unidad_compra: z.string().trim().min(1).max(30).optional().nullable(),
        contenido_compra: z.coerce.number().positive().optional().nullable(),
        costo_unitario_base: z.coerce.number().nonnegative(),
        importe: z.coerce.number().nonnegative().optional().nullable(),
      })).min(1),
    }).parse(req.body);
    const resultado = await registrarCompra(req.auth!.negocioId, {
      ...body,
      lineas: body.lineas.map((linea) => ({ ...linea, product_id: BigInt(linea.product_id) })),
    });
    res.status(201).json(resultado);
  }),
);

// --- Fase 7: borrador de conteo asistido por IA (la IA propone, el usuario confirma) ---
inventarioRouter.get(
  '/draft/estado',
  asyncHandler(async (_req, res) => {
    res.json({ disponible: draftDisponible() });
  }),
);

inventarioRouter.post(
  '/draft',
  asyncHandler(async (req, res) => {
    const b = z.object({
      texto: z.string().optional(),
      imagen_base64: z.string().optional(),
      imagen_tipo: z.string().optional(),
    }).parse(req.body);
    res.json(await borradorConteo(req.auth!.negocioId, b));
  }),
);
