import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import * as svc from './service.js';

export const tareasRouter = Router();
tareasRouter.use(requireAuth); // admin y empleado

const id = z.coerce.number().int().positive();
const tipoChecklist = z.enum(['apertura', 'cierre']);

// --- Día de tareas (ambos roles) ---
tareasRouter.get('/dia', asyncHandler(async (req, res) => {
  const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(new Date().toISOString().slice(0, 10)).parse(req.query.fecha);
  res.json(await svc.diaDeTareas(req.auth!.negocioId, fecha));
}));

tareasRouter.patch('/resultados', asyncHandler(async (req, res) => {
  const b = z.object({ instancia_id: id, item_id: id, completado: z.boolean() }).parse(req.body);
  res.json(await svc.marcarResultado(req.auth!.negocioId, req.auth!.usuarioId, BigInt(b.instancia_id), BigInt(b.item_id), b.completado));
}));

// --- Gestión de checklists (solo admin) ---
tareasRouter.get('/checklists', asyncHandler(async (req, res) => {
  res.json(await svc.listarChecklists(req.auth!.negocioId));
}));

tareasRouter.post('/checklists', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ nombre: z.string().min(1), tipo: tipoChecklist }).parse(req.body);
  res.status(201).json(await svc.crearChecklist(req.auth!.negocioId, b));
}));

tareasRouter.patch('/checklists/:id', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() }).parse(req.body);
  res.json(await svc.actualizarChecklist(req.auth!.negocioId, BigInt(id.parse(req.params.id)), b));
}));

tareasRouter.post('/checklists/:id/items', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ texto: z.string().min(1), orden: z.coerce.number().int().optional() }).parse(req.body);
  res.status(201).json(await svc.agregarItem(req.auth!.negocioId, BigInt(id.parse(req.params.id)), b));
}));

tareasRouter.patch('/items/:id', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ texto: z.string().min(1).optional(), orden: z.coerce.number().int().optional() }).parse(req.body);
  res.json(await svc.actualizarItem(req.auth!.negocioId, BigInt(id.parse(req.params.id)), b));
}));

tareasRouter.delete('/items/:id', soloAdmin, asyncHandler(async (req, res) => {
  await svc.eliminarItem(req.auth!.negocioId, BigInt(id.parse(req.params.id)));
  res.status(204).end();
}));
