import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { reconcilePreview } from './client.js';
import { importarVentasEpos, listarImportacionesEpos, listarVentasEpos, listarExcepcionesEpos } from './imports.js';
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
    persist_local: true,
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

/** Importa ventas de Epos con clave idempotente. Sigue siendo solo lectura
 * respecto a Epos e inventario; deja evidencia persistida para el piloto. */
eposRouter.post('/sync', asyncHandler(async (req, res) => {
  const body = previewSchema.parse(req.body);
  if (new Date(body.from) >= new Date(body.to)) {
    res.status(400).json({ error: 'El inicio debe ser anterior al final' });
    return;
  }
  res.status(201).json(await importarVentasEpos({ negocioId: req.auth!.negocioId, from: body.from, to: body.to, locationId: body.location_id }));
}));

/** Atajo para el cierre operativo de un día. Consulta el día completo en Epos,
 * persiste las líneas y devuelve los métodos de pago listos para confirmar. */
eposRouter.post('/sync-daily', asyncHandler(async (req, res) => {
  const body = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    offset: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('-06:00'),
    location_id: z.coerce.number().int().positive().optional(),
  }).parse(req.body);
  const start = `${body.fecha}T00:00:00${body.offset}`;
  const endDate = new Date(`${body.fecha}T12:00:00${body.offset}`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = `${endDate.toISOString().slice(0, 10)}T00:00:00${body.offset}`;
  res.status(201).json(await importarVentasEpos({ negocioId: req.auth!.negocioId, from: start, to: end, locationId: body.location_id }));
}));

eposRouter.get('/imports', asyncHandler(async (req, res) => {
  const limite = req.query.limit === undefined ? 20 : z.coerce.number().int().positive().parse(req.query.limit);
  res.json(await listarImportacionesEpos(req.auth!.negocioId, limite));
}));

eposRouter.get('/sales', asyncHandler(async (req, res) => {
  const from = req.query.from === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.from);
  const to = req.query.to === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.to);
  const limite = req.query.limit === undefined ? 5000 : z.coerce.number().int().positive().parse(req.query.limit);
  res.json(await listarVentasEpos({ negocioId: req.auth!.negocioId, from, to, limite }));
}));

eposRouter.get('/exceptions', asyncHandler(async (req, res) => {
  const from = req.query.from === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.from);
  const to = req.query.to === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.to);
  res.json(await listarExcepcionesEpos({ negocioId: req.auth!.negocioId, from, to }));
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
