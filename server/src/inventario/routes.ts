import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { inventarioActual, listaCompras, crearConteo, listarSnapshots } from './service.js';
import { borradorCompraTicket, borradorConteo, draftDisponible } from './draft.js';
import { listarLotes, registrarCompra } from './compras.js';
import { prepararAperturaFifo } from './apertura-fifo.js';
import { consumirVentasEpos, costearVentasPendientesEnVivo, estadoFifoEnVivo } from './consumo-epos.js';
import { actualizarBorradorLineas, cambiarOrigenPagoCompra, confirmarBorradorCompra, crearBorradorCompra, editarCompraConfirmada, listarBorradoresCompra, listarCompras, obtenerCompraConfirmada, obtenerFotoCompra, rechazarBorradorCompra, referenciasCompra, validarCapturaCompra } from './compras-rapidas.js';

export const inventarioRouter = Router();

// Inventario y tareas son accesibles para admin y empleado.
inventarioRouter.use(requireAuth);

/** GET /inventario/current — conteo físico y existencia operativa FIFO actual. */
inventarioRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    res.json(await inventarioActual(req.auth!.negocioId, { vista: 'operativa' }));
  }),
);

inventarioRouter.get('/snapshots', asyncHandler(async (req, res) => {
  const semanaId = req.query.semana_id ? BigInt(z.coerce.number().int().positive().parse(req.query.semana_id)) : undefined;
  res.json(await listarSnapshots(req.auth!.negocioId, semanaId));
}));

/** GET /inventario/shopping-list — faltantes agrupados por tienda. */
inventarioRouter.get(
  '/shopping-list',
  asyncHandler(async (req, res) => {
    res.json(await listaCompras(req.auth!.negocioId));
  }),
);

const conteoSchema = z.object({
  tipo: z.enum(['apertura', 'cierre', 'ajuste', 'conteo_operativo']).default('conteo_operativo'),
  unidad_conteo: z.enum(['captura', 'operativa']).default('captura'),
  semana_id: z.coerce.number().int().positive().nullable().optional(),
  motivo: z.string().trim().max(500).nullable().optional(),
  nota: z.string().trim().max(1000).nullable().optional(),
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
    const body = conteoSchema.parse(req.body);
    if (body.tipo !== 'conteo_operativo' && req.auth!.rol !== 'admin') {
      throw new HttpError(403, 'Sólo un administrador puede registrar aperturas, cierres o ajustes');
    }
    const r = await crearConteo(req.auth!.negocioId, body.lineas, {
      tipo: body.tipo,
      unidad_conteo: body.unidad_conteo,
      semana_id: body.semana_id ?? null,
      motivo: body.motivo,
      nota: body.nota,
    });
    res.status(201).json(r);
  }),
);

inventarioRouter.get('/compras/referencias', asyncHandler(async (req, res) => {
  res.json(await referenciasCompra(req.auth!.negocioId));
}));

inventarioRouter.get('/compras', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.fecha) : undefined;
  res.json(await listarCompras(req.auth!.negocioId, fecha));
}));

inventarioRouter.post('/compras/rapidas/ocr', asyncHandler(async (req, res) => {
  const body = z.object({ imagen_base64: z.string().min(100), imagen_tipo: z.string().regex(/^image\//), modo: z.enum(['ticket', 'orden_manuscrita']).default('ticket') }).parse(req.body);
  res.json(await borradorCompraTicket(req.auth!.negocioId, body));
}));

/** GET /inventario/lotes — libro FIFO para revisión; no modifica existencias. */
inventarioRouter.get(
  '/lotes',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const productId = req.query.product_id ? BigInt(z.coerce.number().int().positive().parse(req.query.product_id)) : undefined;
    res.json(await listarLotes(req.auth!.negocioId, productId));
  }),
);

/** POST /inventario/apertura-fifo — materializa el snapshot de apertura como lotes FIFO. */
inventarioRouter.post('/apertura-fifo', soloAdmin, asyncHandler(async (req, res) => {
  const body = z.object({ semana_id: z.coerce.number().int().positive(), criterio: z.literal('catalogo').default('catalogo'), modo: z.enum(['normal', 'historico_prueba']).default('normal') }).parse(req.body);
  res.status(201).json(await prepararAperturaFifo({ negocioId: req.auth!.negocioId, semanaId: BigInt(body.semana_id), criterio: body.criterio, modo: body.modo }));
}));

/** POST /inventario/compras — registra compra revisada y crea lotes FIFO. */
inventarioRouter.post(
  '/compras',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({
      confirmada: z.literal(true),
      fecha_recepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      proveedor: z.string().trim().min(1).optional().nullable(),
      ticket_ref: z.string().trim().min(1).optional().nullable(),
      total: z.coerce.number().nonnegative().optional().nullable(),
      moneda: z.string().trim().min(1).max(8).default('MXN'),
      fuente: z.string().trim().min(1).max(40).default('manual'),
      notas: z.string().trim().max(1000).optional().nullable(),
      lineas: z.array(z.object({
        product_id: z.coerce.number().int().positive(),
        cantidad_base: z.coerce.number().positive(),
        unidad_compra: z.string().trim().min(1).max(30).optional().nullable(),
        contenido_compra: z.coerce.number().positive().optional().nullable(),
        costo_unitario_base: z.coerce.number().nonnegative(),
        importe: z.coerce.number().nonnegative().optional().nullable(),
      })).min(1),
    }).parse(req.body);
    const resultado = await registrarCompra(req.auth!.negocioId, {
      ...body,
      lineas: body.lineas.map((linea) => ({ ...linea, product_id: BigInt(linea.product_id) })),
    });
    res.status(201).json(resultado);
  }),
);

/** Captura rápida desde celular. Empleados pueden dejarla en revisión; no crea FIFO todavía. */
inventarioRouter.post('/compras/rapidas', asyncHandler(async (req, res) => {
  const body = z.object({
    fecha_recepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    proveedor: z.string().trim().max(160).optional().nullable(),
    ticket_ref: z.string().trim().max(120).optional().nullable(),
    total: z.coerce.number().nonnegative().optional().nullable(),
    tipo_documento: z.enum(['ticket', 'orden_manuscrita']).default('ticket'),
    moneda: z.string().trim().min(1).max(8).default('MXN'),
    notas: z.string().trim().max(1000).optional().nullable(),
    origen_pago_id: z.coerce.number().int().positive().optional().nullable(),
    foto_data: z.string().optional().nullable(),
    foto_mime: z.string().optional().nullable(),
    lineas: z.array(z.object({
      product_id: z.coerce.number().int().positive().optional().nullable(),
      tipo_linea: z.enum(['inventario', 'gasto', 'pendiente']).default('pendiente'),
      descripcion_fuente: z.string().trim().min(1).max(240),
      cantidad_fuente: z.coerce.number().nonnegative().optional().nullable(),
      unidad_fuente: z.string().trim().max(30).optional().nullable(),
      cantidad_base: z.coerce.number().positive().optional().nullable(),
      unidad_compra: z.string().trim().max(30).optional().nullable(),
      contenido_compra: z.coerce.number().positive().optional().nullable(),
      costo_unitario: z.coerce.number().nonnegative().optional().nullable(),
      importe: z.coerce.number().nonnegative(),
      confianza: z.coerce.number().min(0).max(1).optional().nullable(),
      notas: z.string().trim().max(500).optional().nullable(),
    })).min(1),
  }).parse(req.body);
  const result = await crearBorradorCompra(req.auth!.negocioId, req.auth!.usuarioId, {
    ...body,
    origen_pago_id: body.origen_pago_id == null ? null : BigInt(body.origen_pago_id),
    lineas: body.lineas.map((l) => ({ ...l, product_id: l.product_id == null ? null : BigInt(l.product_id) })),
  });
  res.status(201).json(result);
}));

inventarioRouter.get('/compras/pendientes', asyncHandler(async (req, res) => {
  res.json(await listarBorradoresCompra(req.auth!.negocioId));
}));

inventarioRouter.post('/compras/validar', asyncHandler(async (req, res) => {
  const body = z.object({
    total: z.coerce.number().nonnegative(),
    lineas: z.array(z.object({
      product_id: z.coerce.number().int().positive().optional().nullable(),
      tipo_linea: z.enum(['inventario', 'gasto', 'pendiente']),
      descripcion_fuente: z.string().trim().min(1).max(240),
      cantidad_fuente: z.coerce.number().nonnegative().optional().nullable(),
      unidad_fuente: z.string().trim().max(30).optional().nullable(),
      cantidad_base: z.coerce.number().positive().optional().nullable(),
      unidad_compra: z.string().trim().max(30).optional().nullable(),
      contenido_compra: z.coerce.number().positive().optional().nullable(),
      costo_unitario: z.coerce.number().nonnegative().optional().nullable(),
      importe: z.coerce.number().nonnegative(),
    })).min(1),
  }).parse(req.body);
  res.json(await validarCapturaCompra(req.auth!.negocioId, body.total, body.lineas.map((l) => ({ ...l, product_id: l.product_id == null ? null : BigInt(l.product_id) }))));
}));

inventarioRouter.get('/compras/:id/foto', asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const foto = await obtenerFotoCompra(req.auth!.negocioId, id);
  res.json(foto);
}));

inventarioRouter.get('/compras/:id', asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  res.json(await obtenerCompraConfirmada(req.auth!.negocioId, id));
}));

inventarioRouter.post('/compras/:id/confirmar', soloAdmin, asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  res.json(await confirmarBorradorCompra(req.auth!.negocioId, req.auth!.usuarioId, id));
}));

/** PATCH /inventario/compras/:id/pago — corrige Banco/Caja sin recrear el FIFO. */
inventarioRouter.patch('/compras/:id/pago', soloAdmin, asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const body = z.object({ origen_pago_id: z.coerce.number().int().positive() }).parse(req.body);
  res.json(await cambiarOrigenPagoCompra(req.auth!.negocioId, id, BigInt(body.origen_pago_id)));
}));

/** PATCH /inventario/compras/:id — edita ticket confirmado y sincroniza FIFO/movimientos. */
inventarioRouter.patch('/compras/:id', soloAdmin, asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const body = z.object({
    fecha_recepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    proveedor: z.string().trim().max(160).nullable().optional(),
    ticket_ref: z.string().trim().max(120).nullable().optional(),
    total: z.coerce.number().nonnegative().optional(),
    origen_pago_id: z.coerce.number().int().positive().nullable().optional(),
    lineas: z.array(z.object({
      product_id: z.coerce.number().int().positive().nullable().optional(),
      tipo_linea: z.enum(['inventario', 'gasto', 'pendiente']),
      descripcion_fuente: z.string().trim().min(1).max(240),
      cantidad_fuente: z.coerce.number().nonnegative().optional().nullable(),
      unidad_fuente: z.string().trim().max(30).optional().nullable(),
      cantidad_base: z.coerce.number().positive().nullable().optional(),
      unidad_compra: z.string().trim().max(30).nullable().optional(),
      contenido_compra: z.coerce.number().positive().nullable().optional(),
      costo_unitario: z.coerce.number().nonnegative().nullable().optional(),
      importe: z.coerce.number().nonnegative(),
      confianza: z.coerce.number().min(0).max(1).nullable().optional(),
      notas: z.string().trim().max(500).nullable().optional(),
    })).min(1),
  }).parse(req.body);
  res.json(await editarCompraConfirmada(req.auth!.negocioId, req.auth!.usuarioId, id, {
    ...body,
    origen_pago_id: body.origen_pago_id == null ? body.origen_pago_id : BigInt(body.origen_pago_id),
    lineas: body.lineas.map((l) => ({ ...l, product_id: l.product_id == null ? null : BigInt(l.product_id), cantidad_base: l.cantidad_base ?? null, unidad_compra: l.unidad_compra ?? null, contenido_compra: l.contenido_compra ?? null, costo_unitario: l.costo_unitario ?? null, confianza: l.confianza ?? null, notas: l.notas ?? null })),
  }));
}));

inventarioRouter.put('/compras/:id/lineas', soloAdmin, asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const body = z.object({ total: z.coerce.number().nonnegative().nullable().optional(), lineas: z.array(z.object({
    product_id: z.coerce.number().int().positive().optional().nullable(),
      tipo_linea: z.enum(['inventario', 'gasto', 'pendiente']),
      descripcion_fuente: z.string().trim().min(1).max(240),
      cantidad_fuente: z.coerce.number().nonnegative().optional().nullable(), unidad_fuente: z.string().trim().max(30).optional().nullable(),
      cantidad_base: z.coerce.number().positive().optional().nullable(), unidad_compra: z.string().trim().max(30).optional().nullable(),
    contenido_compra: z.coerce.number().positive().optional().nullable(), costo_unitario: z.coerce.number().nonnegative().optional().nullable(),
    importe: z.coerce.number().nonnegative(), confianza: z.coerce.number().min(0).max(1).optional().nullable(), notas: z.string().trim().max(500).optional().nullable(),
  })).min(1) }).parse(req.body);
  res.json(await actualizarBorradorLineas(req.auth!.negocioId, id, body.lineas.map((l) => ({ ...l, product_id: l.product_id == null ? null : BigInt(l.product_id) })), body.total));
}));

inventarioRouter.post('/compras/:id/rechazar', soloAdmin, asyncHandler(async (req, res) => {
  const id = BigInt(z.coerce.number().int().positive().parse(req.params.id));
  const body = z.object({ nota: z.string().trim().max(1000).optional() }).parse(req.body);
  res.json(await rechazarBorradorCompra(req.auth!.negocioId, id, body.nota));
}));

/** POST /inventario/consumo-epos — vista previa o aplicación del consumo FIFO. */
inventarioRouter.post(
  '/consumo-epos',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
      confirmar: z.boolean().default(false),
      modo: z.enum(['normal', 'historico_prueba']).default('normal'),
    }).parse(req.body);
    res.json(await consumirVentasEpos({ negocioId: req.auth!.negocioId, ...body }));
  }),
);

/** GET /inventario/fifo/live-status — estado del libro FIFO continuo. */
inventarioRouter.get('/fifo/live-status', asyncHandler(async (req, res) => {
  res.json(await estadoFifoEnVivo(req.auth!.negocioId));
}));

/** POST /inventario/fifo/reprocesar — reintenta ventas pendientes/excepciones
 * sin tocar ventas ya costeadas ni crear consumos duplicados. */
inventarioRouter.post('/fifo/reprocesar', soloAdmin, asyncHandler(async (req, res) => {
  const body = z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }).parse(req.body ?? {});
  res.json(await costearVentasPendientesEnVivo({
    negocioId: req.auth!.negocioId,
    from: body.from ? new Date(body.from) : undefined,
    to: body.to ? new Date(body.to) : undefined,
  }));
}));

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
