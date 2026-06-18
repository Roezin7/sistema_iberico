import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../auth/middleware.js';
import { inventarioActual, listaCompras, crearConteo } from './service.js';
import { borradorConteo, draftDisponible } from './draft.js';

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
