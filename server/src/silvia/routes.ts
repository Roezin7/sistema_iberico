import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { silviaDisponible } from './agent.js';
import * as svc from './service.js';

export const silviaRouter = Router();

// Silvia ve finanzas y KPIs -> admin only.
silviaRouter.use(requireAuth, soloAdmin);

const id = z.coerce.number().int().positive();

/** Indica si la IA está configurada (hay API key) — para mostrar/ocultar la burbuja. */
silviaRouter.get('/estado', asyncHandler(async (_req, res) => {
  res.json({ disponible: silviaDisponible() });
}));

silviaRouter.get('/historial', asyncHandler(async (req, res) => {
  res.json(await svc.historial(req.auth!.negocioId));
}));

/** Borra la conversación (al cerrar sesión). Conserva la memoria/aprendizajes. */
silviaRouter.delete('/historial', asyncHandler(async (req, res) => {
  await svc.borrarHistorial(req.auth!.negocioId);
  res.status(204).end();
}));

silviaRouter.post('/chat', asyncHandler(async (req, res) => {
  const { mensaje } = z.object({ mensaje: z.string().min(1).max(2000) }).parse(req.body);
  res.json(await svc.chat(req.auth!.negocioId, mensaje));
}));

silviaRouter.get('/memoria', asyncHandler(async (req, res) => {
  res.json(await svc.listarMemoria(req.auth!.negocioId));
}));

silviaRouter.post('/eventos', asyncHandler(async (req, res) => {
  const b = z.object({ contenido: z.string().min(1).max(500), fecha: z.string().optional() }).parse(req.body);
  res.status(201).json(await svc.registrarEvento(req.auth!.negocioId, b.contenido, b.fecha));
}));

silviaRouter.delete('/memoria/:id', asyncHandler(async (req, res) => {
  await svc.borrarMemoria(req.auth!.negocioId, BigInt(id.parse(req.params.id)));
  res.status(204).end();
}));
