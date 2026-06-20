import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import * as svc from './service.js';

export const finanzasRouter = Router();

// Finanzas es exclusivo de admin (gating en backend, no solo UI).
finanzasRouter.use(requireAuth, soloAdmin);

const tipoMovimiento = z.enum([
  'venta_efectivo', 'venta_tarjeta', 'propina_tarjeta', 'comision_terminal', 'gasto',
  'sueldo', 'compra_inventario', 'transferencia', 'retiro_socio', 'deposito', 'propina_pagada',
]);

const id = z.coerce.number().int().positive();

// --- Referencias y saldos iniciales ---
finanzasRouter.get('/referencias', asyncHandler(async (req, res) => {
  res.json(await svc.referencias(req.auth!.negocioId));
}));

finanzasRouter.get('/saldos-iniciales', asyncHandler(async (req, res) => {
  res.json(await svc.getSaldosIniciales(req.auth!.negocioId));
}));

finanzasRouter.post('/saldos-iniciales', asyncHandler(async (req, res) => {
  const body = z.object({
    saldos: z.array(z.object({ ubicacion_id: id, monto: z.coerce.number() })).min(1),
  }).parse(req.body);
  res.status(201).json(await svc.fijarSaldosIniciales(req.auth!.negocioId, body.saldos));
}));

// --- Semanas ---
finanzasRouter.get('/semanas', asyncHandler(async (req, res) => {
  res.json(await svc.listarSemanas(req.auth!.negocioId));
}));

finanzasRouter.get('/semanas/actual', asyncHandler(async (req, res) => {
  res.json(await svc.semanaActual(req.auth!.negocioId));
}));

finanzasRouter.post('/semanas', asyncHandler(async (req, res) => {
  const body = z.object({ fecha_inicio: z.string().optional() }).parse(req.body);
  res.status(201).json(await svc.crearSemana(req.auth!.negocioId, body.fecha_inicio));
}));

finanzasRouter.post('/semanas/:id/cerrar', asyncHandler(async (req, res) => {
  const semanaId = BigInt(id.parse(req.params.id));
  res.json(await svc.cerrarSemana(req.auth!.negocioId, req.auth!.usuarioId, semanaId));
}));

finanzasRouter.post('/semanas/:id/reabrir', asyncHandler(async (req, res) => {
  res.json(await svc.reabrirSemana(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

finanzasRouter.get('/semanas/:id/cuadre', asyncHandler(async (req, res) => {
  res.json(await svc.cuadre(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

finanzasRouter.get('/semanas/:id/resumen', asyncHandler(async (req, res) => {
  res.json(await svc.resumen(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

finanzasRouter.get('/semanas/:id/movimientos', asyncHandler(async (req, res) => {
  res.json(await svc.listarMovimientos(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

// --- Captura diaria ---
finanzasRouter.get('/semanas/:id/dias', asyncHandler(async (req, res) => {
  res.json(await svc.resumenDiario(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

finanzasRouter.put('/semanas/:id/dias', asyncHandler(async (req, res) => {
  const body = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    venta_efectivo: z.coerce.number().min(0).default(0),
    venta_tarjeta: z.coerce.number().min(0).default(0),
    propina_tarjeta: z.coerce.number().min(0).default(0),
    gasto_efectivo: z.coerce.number().min(0).default(0),
    sueldos: z.coerce.number().min(0).default(0),
  }).parse(req.body);
  const semanaId = BigInt(id.parse(req.params.id));
  res.json(await svc.registrarDia(req.auth!.negocioId, req.auth!.usuarioId, semanaId, body.fecha, body));
}));

// --- Movimientos ---
finanzasRouter.post('/movimientos', asyncHandler(async (req, res) => {
  const body = z.object({
    semana_id: id,
    tipo: tipoMovimiento,
    monto: z.coerce.number().positive(),
    fecha: z.string().optional(),
    ubicacion_origen_id: id.nullable().optional(),
    ubicacion_destino_id: id.nullable().optional(),
    categoria_id: id.nullable().optional(),
    socio_id: id.nullable().optional(),
    facturado: z.boolean().optional(),
    descripcion: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await svc.crearMovimiento(req.auth!.negocioId, req.auth!.usuarioId, body));
}));

finanzasRouter.delete('/movimientos/:id', asyncHandler(async (req, res) => {
  await svc.borrarMovimiento(req.auth!.negocioId, BigInt(id.parse(req.params.id)));
  res.status(204).end();
}));

// --- Arqueos ---
finanzasRouter.post('/arqueos', asyncHandler(async (req, res) => {
  const body = z.object({
    semana_id: id,
    ubicacion_id: id,
    monto_real: z.coerce.number(),
    fecha: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(
    await svc.crearArqueo(req.auth!.negocioId, req.auth!.usuarioId, BigInt(body.semana_id), body.ubicacion_id, body.monto_real, body.fecha),
  );
}));

// --- Configuración (admin): saldos, ubicaciones, categorías, socios ---
finanzasRouter.get('/config', asyncHandler(async (req, res) => {
  res.json(await svc.adminConfig(req.auth!.negocioId));
}));

finanzasRouter.put('/saldos-iniciales', asyncHandler(async (req, res) => {
  const body = z.object({
    saldos: z.array(z.object({ ubicacion_id: id, monto: z.coerce.number() })).min(1),
  }).parse(req.body);
  res.json(await svc.editarSaldosIniciales(req.auth!.negocioId, body.saldos));
}));

const tipoUbic = z.enum(['banco', 'efectivo']);

finanzasRouter.post('/ubicaciones', asyncHandler(async (req, res) => {
  const body = z.object({ nombre: z.string().min(1), tipo: tipoUbic, socio_id: id.nullable().optional() }).parse(req.body);
  res.status(201).json(await svc.crearUbicacion(req.auth!.negocioId, body));
}));

finanzasRouter.patch('/ubicaciones/:id', asyncHandler(async (req, res) => {
  const body = z.object({ nombre: z.string().min(1).optional(), tipo: tipoUbic.optional(), socio_id: id.nullable().optional(), activo: z.boolean().optional() }).parse(req.body);
  res.json(await svc.editarUbicacion(req.auth!.negocioId, BigInt(id.parse(req.params.id)), body));
}));

finanzasRouter.post('/categorias', asyncHandler(async (req, res) => {
  const { nombre } = z.object({ nombre: z.string().min(1) }).parse(req.body);
  res.status(201).json(await svc.crearCategoria(req.auth!.negocioId, nombre));
}));

finanzasRouter.patch('/categorias/:id', asyncHandler(async (req, res) => {
  const body = z.object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() }).parse(req.body);
  res.json(await svc.editarCategoria(req.auth!.negocioId, BigInt(id.parse(req.params.id)), body));
}));

finanzasRouter.post('/socios', asyncHandler(async (req, res) => {
  const { nombre } = z.object({ nombre: z.string().min(1) }).parse(req.body);
  res.status(201).json(await svc.crearSocio(req.auth!.negocioId, nombre));
}));

finanzasRouter.patch('/socios/:id', asyncHandler(async (req, res) => {
  const body = z.object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() }).parse(req.body);
  res.json(await svc.editarSocio(req.auth!.negocioId, BigInt(id.parse(req.params.id)), body));
}));
