import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import * as svc from './service.js';

export const patrimonioRouter = Router();

// Patrimonio es admin-only (gating en backend).
patrimonioRouter.use(requireAuth, soloAdmin);

const id = z.coerce.number().int().positive();

patrimonioRouter.get('/snapshots', asyncHandler(async (req, res) => {
  res.json(await svc.listarSnapshots(req.auth!.negocioId));
}));

patrimonioRouter.get('/tendencia', asyncHandler(async (req, res) => {
  res.json(await svc.tendencia(req.auth!.negocioId));
}));

// --- Pasivos ---
patrimonioRouter.get('/pasivos', asyncHandler(async (req, res) => {
  res.json(await svc.listarPasivos(req.auth!.negocioId));
}));

const pasivoBody = z.object({
  nombre: z.string().min(1),
  monto: z.coerce.number().min(0),
  tipo: z.string().nullable().optional(),
});

patrimonioRouter.post('/pasivos', asyncHandler(async (req, res) => {
  const b = pasivoBody.parse(req.body);
  res.status(201).json(await svc.crearPasivo(req.auth!.negocioId, b));
}));

patrimonioRouter.patch('/pasivos/:id', asyncHandler(async (req, res) => {
  const b = pasivoBody.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  res.json(await svc.actualizarPasivo(req.auth!.negocioId, BigInt(id.parse(req.params.id)), b));
}));
