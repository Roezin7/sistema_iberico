import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import * as svc from './service.js';
import { crearCorreccionInventario, listarCorrecciones, referenciasCorreccion } from '../inventario/correcciones.js';

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

// Vista histórica para dirección: agrupa por mes calendario y declara la
// fuente usada para costo de ventas (FIFO, inventario o compras).
finanzasRouter.get('/estado-resultados', asyncHandler(async (req, res) => {
  const meses = req.query.meses == null ? undefined : z.coerce.number().int().positive().optional().parse(req.query.meses);
  res.json(await svc.estadoResultados(req.auth!.negocioId, meses));
}));

finanzasRouter.get('/tablero-decisiones', asyncHandler(async (req, res) => {
  const semanas = req.query.semanas == null ? undefined : z.coerce.number().int().positive().optional().parse(req.query.semanas);
  res.json(await svc.tableroDecisiones(req.auth!.negocioId, semanas));
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
  const body = z.object({ confirmar_excepciones: z.boolean().optional().default(false) }).parse(req.body ?? {});
  res.json(await svc.cerrarSemana(req.auth!.negocioId, req.auth!.usuarioId, semanaId, body.confirmar_excepciones));
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

/** Conciliación física/FIFO congelada para auditoría del cierre. */
finanzasRouter.get('/semanas/:id/conciliacion-inventario', asyncHandler(async (req, res) => {
  res.json(await svc.conciliacionInventarioSemana(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

/** Cola de costeo agrupada por causa raíz para operación diaria. */
finanzasRouter.get('/semanas/:id/excepciones-costeo', asyncHandler(async (req, res) => {
  res.json(await svc.listarExcepcionesCosteoSemana(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

/** Recalcula y reemplaza únicamente la conciliación de esa semana. */
finanzasRouter.post('/semanas/:id/conciliacion-inventario/recalcular', asyncHandler(async (req, res) => {
  res.json(await svc.persistirConciliacionInventarioSemana(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

/** Referencias y correcciones físicas auditables ligadas a una semana. */
finanzasRouter.get('/semanas/:id/inventario-correcciones/referencias', asyncHandler(async (req, res) => {
  res.json(await referenciasCorreccion(req.auth!.negocioId));
}));

finanzasRouter.get('/semanas/:id/inventario-correcciones', asyncHandler(async (req, res) => {
  res.json(await listarCorrecciones(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

finanzasRouter.post('/semanas/:id/inventario-correcciones', asyncHandler(async (req, res) => {
  const body = z.object({
    product_id: id,
    zona_id: id,
    cantidad_base: z.coerce.number().finite().refine((n) => n !== 0, 'La corrección no puede ser cero'),
    motivo: z.string().trim().min(5).max(500),
    nota: z.string().trim().max(1000).nullable().optional(),
    solicitud_id: z.string().trim().max(120).nullable().optional(),
  }).parse(req.body);
  const resultado = await crearCorreccionInventario({
    negocioId: req.auth!.negocioId, usuarioId: req.auth!.usuarioId, semanaId: BigInt(id.parse(req.params.id)),
    productId: BigInt(body.product_id), zonaId: BigInt(body.zona_id), cantidadBase: body.cantidad_base,
    motivo: body.motivo, nota: body.nota, solicitudId: body.solicitud_id,
  });
  res.status(201).json(resultado);
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

finanzasRouter.patch('/movimientos/:id', asyncHandler(async (req, res) => {
  const body = z.object({
    monto: z.coerce.number().positive().optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ubicacion_origen_id: id.nullable().optional(),
    ubicacion_destino_id: id.nullable().optional(),
    categoria_id: id.nullable().optional(),
    descripcion: z.string().max(500).nullable().optional(),
    facturado: z.boolean().optional(),
  }).parse(req.body);
  res.json(await svc.editarMovimiento(req.auth!.negocioId, BigInt(id.parse(req.params.id)), body));
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
