import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { actualizarFactura, listarFacturas, obtenerComprobanteFactura } from './service.js';

export const facturacionRouter = Router();
facturacionRouter.use(requireAuth, soloAdmin);

facturacionRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await listarFacturas(req.auth!.negocioId));
}));

facturacionRouter.get('/:id/comprobante', asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  res.json(await obtenerComprobanteFactura(req.auth!.negocioId, id));
}));

facturacionRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const body = z.object({
    estado: z.enum(['no_facturado', 'facturado']).optional(),
    comprobante_data: z.string().optional().nullable(),
    comprobante_mime: z.string().max(100).optional().nullable(),
    comprobante_nombre: z.string().max(180).optional().nullable(),
    notas: z.string().max(1000).optional().nullable(),
  }).parse(req.body);
  res.json(await actualizarFactura(req.auth!.negocioId, id, body));
}));
