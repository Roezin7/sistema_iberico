import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { reconcilePreview } from './client.js';
import { confirmarConciliacionDiaria, listarConciliacionesDiarias } from './reconciliation.js';
import { env } from '../env.js';

export const eposRouter = Router();
eposRouter.use(requireAuth, soloAdmin);

/** Estado de configuración del puente; nunca devuelve secretos. */
eposRouter.get('/status', asyncHandler(async (_req, res) => {
  res.json({
    configured: Boolean(env.EPOS_API_KEY && env.EPOS_API_SECRET),
    base_url: env.EPOS_API_BASE_URL,
    location_id: env.EPOS_LOCATION_ID ?? null,
    read_only: true,
  });
}));

const previewSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  location_id: z.coerce.number().int().positive().optional(),
});

/** Consulta histórica de solo lectura. No persiste ventas ni altera inventario. */
eposRouter.post('/reconcile-preview', asyncHandler(async (req, res) => {
  const body = previewSchema.parse(req.body);
  if (new Date(body.from) >= new Date(body.to)) {
    res.status(400).json({ error: 'El inicio debe ser anterior al final' });
    return;
  }
  res.json(await reconcilePreview(body.from, body.to, body.location_id));
}));

const dailySchema = z.object({
  semana_id: z.coerce.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  epos: z.object({ ventas: z.coerce.number().min(0), efectivo: z.coerce.number().min(0), tarjeta: z.coerce.number().min(0), otros: z.coerce.number().min(0) }),
  confirmado: z.object({ ventas: z.coerce.number().min(0), efectivo: z.coerce.number().min(0), tarjeta: z.coerce.number().min(0), otros: z.coerce.number().min(0) }),
  cuentas_abiertas: z.coerce.number().min(0).default(0),
  excepciones: z.array(z.record(z.unknown())).default([]),
  notas: z.string().max(2000).optional(),
});

eposRouter.get('/conciliaciones-diarias', asyncHandler(async (req, res) => {
  const semanaId = z.coerce.number().int().positive().parse(req.query.semana_id);
  res.json(await listarConciliacionesDiarias(req.auth!.negocioId, BigInt(semanaId)));
}));

eposRouter.post('/conciliaciones-diarias', asyncHandler(async (req, res) => {
  const body = dailySchema.parse(req.body);
  const row = await confirmarConciliacionDiaria({
    negocioId: req.auth!.negocioId, usuarioId: req.auth!.usuarioId, semanaId: BigInt(body.semana_id),
    fecha: body.fecha, epos: body.epos, confirmado: body.confirmado,
    cuentasAbiertas: body.cuentas_abiertas, excepciones: body.excepciones, notas: body.notas,
  });
  res.status(201).json(row);
}));
