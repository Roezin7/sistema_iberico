import { fechaCivilSchema } from '../lib/fechas.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { product, reconcilePreview } from './client.js';
import { importarVentasEpos, listarImportacionesEpos, listarVentasEpos, listarExcepcionesEpos, resumirExcepcionesEpos } from './imports.js';
import { confirmarConciliacionDiaria, listarConciliacionesDiarias } from './reconciliation.js';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { aplicarMapeoEpos, auditarMapeoEpos } from './mapeo-menu.js';

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

/** Importa ventas de Epos con clave idempotente. Es de solo lectura respecto a
 * Epos, persiste la evidencia local y dispara el costeo FIFO en vivo. */
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
    fecha: fechaCivilSchema,
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
  const importacionId = req.query.importacion_id === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.importacion_id);
  const limite = req.query.limit === undefined ? 5000 : z.coerce.number().int().positive().parse(req.query.limit);
  res.json(await listarVentasEpos({ negocioId: req.auth!.negocioId, from, to, importacionId, limite }));
}));

eposRouter.get('/exceptions', asyncHandler(async (req, res) => {
  const from = req.query.from === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.from);
  const to = req.query.to === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.to);
  res.json(await listarExcepcionesEpos({ negocioId: req.auth!.negocioId, from, to }));
}));

eposRouter.get('/exceptions/summary', asyncHandler(async (req, res) => {
  const from = req.query.from === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.from);
  const to = req.query.to === undefined ? undefined : z.string().datetime({ offset: true }).parse(req.query.to);
  res.json(await resumirExcepcionesEpos({ negocioId: req.auth!.negocioId, from, to }));
}));

eposRouter.get('/mapeo-menu', asyncHandler(async (req, res) => {
  const from = req.query.from === undefined ? undefined : new Date(z.string().datetime({ offset: true }).parse(req.query.from));
  const to = req.query.to === undefined ? undefined : new Date(z.string().datetime({ offset: true }).parse(req.query.to));
  res.json(await auditarMapeoEpos({ negocioId: req.auth!.negocioId, from, to }));
}));

/**
 * Compara el nombre remoto de Epos con el catálogo canónico local. Es una
 * lectura explícita: no actualiza Epos ni reescribe ventas históricas.
 */
eposRouter.get('/catalogo-live', asyncHandler(async (req, res) => {
  const menu = await prisma.productos_menu.findMany({
    where: { negocio_id: req.auth!.negocioId, activo: true, epos_product_id: { not: null } },
    select: { id: true, nombre: true, epos_product_id: true },
    orderBy: { nombre: 'asc' },
  });
  const resultados: Array<Record<string, unknown>> = [];
  for (const item of menu) {
    const eposId = item.epos_product_id!;
    try {
      const remoto = await product(eposId);
      const nombreRemoto = String(remoto.Name ?? remoto.name ?? '').trim() || null;
      resultados.push({
        menu_id: Number(item.id), epos_product_id: eposId, nombre_canonico: item.nombre,
        nombre_epos: nombreRemoto,
        estado: nombreRemoto && nombreRemoto !== item.nombre ? 'diferente' : nombreRemoto ? 'coincide' : 'sin_nombre',
      });
    } catch (error) {
      resultados.push({
        menu_id: Number(item.id), epos_product_id: eposId, nombre_canonico: item.nombre,
        nombre_epos: null, estado: 'no_disponible',
        error: error instanceof Error ? error.message : 'No se pudo consultar Epos',
      });
    }
  }
  res.json({ fuente: 'Epos Now', lectura: true, total: resultados.length, diferencias: resultados.filter((row) => row.estado === 'diferente').length, productos: resultados });
}));

eposRouter.post('/mapeo-menu/aplicar', asyncHandler(async (req, res) => {
  const body = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }).parse(req.body);
  res.json(await aplicarMapeoEpos({ negocioId: req.auth!.negocioId, from: body.from ? new Date(body.from) : undefined, to: body.to ? new Date(body.to) : undefined }));
}));

const dailySchema = z.object({
  semana_id: z.coerce.number().int().positive(),
  fecha: fechaCivilSchema,
  epos: z.object({ ventas: z.coerce.number().min(0), efectivo: z.coerce.number().min(0), tarjeta: z.coerce.number().min(0), otros: z.coerce.number().min(0) }),
  confirmado: z.object({ ventas: z.coerce.number().min(0), efectivo: z.coerce.number().min(0), tarjeta: z.coerce.number().min(0), otros: z.coerce.number().min(0) }),
  cuentas_abiertas: z.coerce.number().int().min(0).default(0),
  diario: z.object({ venta_efectivo: z.number().finite().nonnegative(), venta_tarjeta: z.number().finite().nonnegative(), propina_tarjeta: z.number().finite().nonnegative(), gasto_efectivo: z.number().finite().nonnegative(), sueldos: z.number().finite().nonnegative() }).optional(),
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
    diario: body.diario,
  });
  res.status(201).json(row);
}));
