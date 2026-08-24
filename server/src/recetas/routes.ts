import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { costoLinea } from './costeo.js';
import { consumirFIFO } from '../inventario/fifo.js';

export const recetasRouter = Router();
recetasRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const linea = z.object({
  product_id: id,
  cantidad: z.coerce.number().positive(),
  unidad: z.string().min(1).max(30),
  nota: z.string().max(250).nullable().optional(),
});

const recetaBody = z.object({
  producto_menu_id: id.nullable().optional(),
  nombre: z.string().min(1).max(150),
  epos_product_id: z.coerce.number().int().positive().nullable().optional(),
  precio_venta: z.coerce.number().min(0).nullable().optional(),
  estado: z.enum(['borrador', 'validada', 'retirada']).default('borrador'),
  fuente: z.string().max(500).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  vigente_desde: z.string().date().nullable().optional(),
  lineas: z.array(linea).default([]),
});

function serialize(p: any) {
  return {
    id: Number(p.id),
    nombre: p.nombre,
    epos_product_id: p.epos_product_id,
    precio_venta: num(p.precio_venta),
    activo: p.activo,
    recetas: (p.recetas ?? []).map((r: any) => ({
      id: Number(r.id),
      version: r.version,
      estado: r.estado,
      fuente: r.fuente,
      notas: r.notas,
      vigente_desde: r.vigente_desde,
      creado_at: r.creado_at,
      lineas: (r.lineas ?? []).map((l: any) => {
        const cantidad = num(l.cantidad) ?? 0;
        const costeo = costoLinea(cantidad, l.unidad, {
          unitCost: num(l.products?.unit_cost),
          unidadBase: l.products?.unidad_base ?? null,
          contenidoCompra: num(l.products?.contenido_compra),
          rendimientoUtil: num(l.products?.rendimiento_util),
        });
        return {
          product_id: Number(l.product_id),
          producto: l.products?.name ?? null,
          cantidad,
          unidad: l.unidad,
          nota: l.nota,
          costo_unitario: costeo.costoUnitarioBase,
          costo_estimado: costeo.costoEstimado,
          cantidad_base: costeo.cantidadBase,
          unidad_base: costeo.unidadBase,
          falta_configuracion: costeo.faltaConfiguracion,
        };
      }),
    })),
  };
}

const ORDEN_MENU = [
  'Montado Mediterraneo', 'Montado Castellano', 'Montado Ibérico', 'Montado Sevillano', 'Montado Ateca',
  'Papas a la francesa', 'Papas Ibéricas', 'Tabla de Tapas', 'Tabla de Quesos y Embutidos',
  'Pizza Margarita', 'Pizza Castellana', 'Pizza Ibérica', 'Pizza Madrileña', 'Pizza Catalana', 'Pizza Dos Carnes',
  'Copa de la Casa', 'Piñada', 'Limonada', 'Limonada Ibérica', 'Naranjada', 'Refresco', 'Cubanito Grande', 'Affogato',
  'Gin Tonic Rojo', 'Gin Tonic Verde', 'Gin Tonic Rosa', 'Gin Tonic de Frutos Rojos', 'Gin Tonic de Pepino',
  'Negroni Ibérico', 'Mezcal-tonic', 'Mezcal Mule', 'Mezcalita Piña', 'Mezcalita Mango', 'Mezcalita Tamarindo', 'Mezcalita Jamaica',
  'Carajillo', 'Baileys', 'Ronchata', 'Mezcachata', 'Oro Blanco', 'Tinto de Verano', 'Sangría Española',
  'Mimosa Clásica', 'Mimosa Ibérica', 'Mojito Clásico', 'Mojito Tinto', 'Perla Negra', 'Toro Negro',
  'Margarita Clásica', 'Margarita de Fresa', 'Tequila Sunrise', 'Piña Colada',
  'Paloma Chica', 'Paloma Grande', 'Vampiro Grande', 'Cuba/Shot Jagger', 'Cuba de hacienda de tepa', 'CBA Doble D',
  'Michelada Chica', 'Michelada Grande', 'Modelo', 'Stella Artois', 'Michelob Ultra',
];
const normalizarMenu = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ORDEN_NORMALIZADO = new Map(ORDEN_MENU.map((nombre, index) => [normalizarMenu(nombre), index]));

function seccionMenu(nombre: string) {
  const n = normalizarMenu(nombre);
  if (n.startsWith('montado')) return 'Montados';
  if (n.startsWith('papa') || n.startsWith('tabla')) return 'Para compartir';
  if (n.startsWith('pizza')) return 'Pizzas';
  if (['modelo', 'stella artois', 'michelob ultra'].some((x) => n === x)) return 'Cervezas';
  if (n.includes('cba doble d') || n.includes('copa de la casa') || n.includes('gin tonic') || n.includes('negroni') || n.includes('mezcal') || n.includes('carajillo') || n.includes('baileys') || n.includes('ronchata') || n.includes('mezcachata') || n.includes('oro blanco') || n.includes('tinto') || n.includes('sangria') || n.includes('mimosa') || n.includes('mojito') || n.includes('perla') || n.includes('toro') || n.includes('margarita') || n.includes('tequila') || n.includes('paloma') || n.includes('vampiro') || n.includes('cuba')) return 'Bebidas con alcohol';
  if (['pinada', 'limonada', 'naranjada', 'refresco', 'affogato'].some((x) => n.startsWith(x))) return 'Sin alcohol';
  return 'Otros';
}

/** Resumen ejecutivo de costos del menú, ordenado como la carta y listo para
 * consulta: no muta datos ni sustituye el costeo FIFO histórico. */
recetasRouter.get('/resumen', asyncHandler(async (req, res) => {
  const productos = await prisma.productos_menu.findMany({
    where: { negocio_id: req.auth!.negocioId, activo: true },
    include: {
      recetas: {
        where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1,
        include: { lineas: { include: { products: { select: { name: true, unit_cost: true, unidad_base: true, contenido_compra: true, rendimiento_util: true } } } } },
      },
    },
  });

  // El costo operativo vigente se calcula sobre todos los lotes FIFO abiertos,
  // incluidos los que vienen de aperturas históricas. Los lotes no desaparecen
  // al cambiar de semana: sólo se agotan por ventas o ajustes trazables.
  const productIds = [...new Set(productos.flatMap((p) => p.recetas[0]?.estado === 'validada'
    ? p.recetas[0].lineas.map((l) => l.product_id.toString())
    : []))].map(BigInt);
  const lotes = productIds.length ? await prisma.inventory_lots.findMany({
    where: {
      negocio_id: req.auth!.negocioId,
      product_id: { in: productIds },
      estado: 'abierto',
      cantidad_restante: { gt: 0 },
    },
    orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
    select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true },
  }) : [];
  const lotesPorProducto = new Map<string, typeof lotes>();
  for (const lote of lotes) {
    const lista = lotesPorProducto.get(lote.product_id.toString()) ?? [];
    lista.push(lote);
    lotesPorProducto.set(lote.product_id.toString(), lista);
  }
  // Un lote puede haberse agotado después de pagar una venta. Conservamos el
  // último costo unitario aplicado para que la vista de costos no retroceda
  // silenciosamente al costo estático cuando ya no queda saldo abierto.
  const consumosRecientes = productIds.length ? await prisma.inventory_consumptions.findMany({
    where: { negocio_id: req.auth!.negocioId, product_id: { in: productIds } },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: { product_id: true, costo_unitario: true, fecha: true },
  }) : [];
  const ultimoCostoPorProducto = new Map<string, { costo: number; fecha: string }>();
  for (const consumo of consumosRecientes) {
    const key = consumo.product_id.toString();
    if (!ultimoCostoPorProducto.has(key)) {
      ultimoCostoPorProducto.set(key, { costo: Number(consumo.costo_unitario), fecha: consumo.fecha.toISOString().slice(0, 10) });
    }
  }

  const items = productos.map((p) => {
    const receta = p.recetas[0];
    const lineas = receta?.lineas.map((l) => {
      const costeo = costoLinea(Number(l.cantidad), l.unidad, { unitCost: num(l.products.unit_cost), unidadBase: l.products.unidad_base, contenidoCompra: num(l.products.contenido_compra), rendimientoUtil: num(l.products.rendimiento_util) });
      const cantidadBase = costeo.cantidadBase;
      const lotesProducto = lotesPorProducto.get(l.product_id.toString()) ?? [];
      const fifo = cantidadBase != null && costeo.unidadBase
        ? consumirFIFO(lotesProducto.map((lote) => ({
          id: Number(lote.id), recibidoAt: lote.recibido_at.toISOString().slice(0, 10),
          cantidadRestante: Number(lote.cantidad_restante), costoUnitario: Number(lote.costo_unitario),
        })), cantidadBase)
        : null;
      const fifoDisponible = fifo != null && fifo.faltante <= 0.0001;
      const ultimoCosto = ultimoCostoPorProducto.get(l.product_id.toString());
      const costoFifoAplicado = !fifoDisponible && cantidadBase != null && ultimoCosto
        ? cantidadBase * ultimoCosto.costo
        : null;
      return {
        producto: l.products.name, cantidad: Number(l.cantidad), unidad: l.unidad,
        cantidad_base: cantidadBase, unidad_base: costeo.unidadBase,
        costo_unitario_base: costeo.costoUnitarioBase, costo: costeo.costoEstimado,
        costo_fifo: fifoDisponible ? fifo.costoTotal : null,
        costo_fifo_aplicado: costoFifoAplicado,
        costo_fifo_referencia: fifoDisponible ? fifo?.costoTotal ?? null : costoFifoAplicado,
        estado_fifo: fifoDisponible ? 'disponible' : costoFifoAplicado != null ? 'aplicado' : fifo ? 'insuficiente' : 'sin_datos',
        ultimo_costo_fifo_unitario: ultimoCosto?.costo ?? null,
        ultimo_costo_fifo_fecha: ultimoCosto?.fecha ?? null,
        falta_fifo: fifo && !fifoDisponible ? `Inventario FIFO insuficiente: faltan ${fifo.faltante} ${costeo.unidadBase ?? ''}`.trim() : null,
        falta_configuracion: costeo.faltaConfiguracion, nota: l.nota,
      };
    }) ?? [];
    const costoCompleto = lineas.length > 0 && lineas.every((l) => l.costo != null && l.falta_configuracion.length === 0);
    const costo = costoCompleto ? lineas.reduce((total, l) => total + (l.costo ?? 0), 0) : null;
    const costoFifoCompleto = receta?.estado === 'validada' && lineas.length > 0 && lineas.every((l) => l.costo_fifo != null && l.falta_configuracion.length === 0);
    const costoFifo = costoFifoCompleto ? lineas.reduce((total, l) => total + (l.costo_fifo ?? 0), 0) : null;
    const costoFifoReferenciaCompleto = receta?.estado === 'validada' && lineas.length > 0 && lineas.every((l) => l.costo_fifo_referencia != null && l.falta_configuracion.length === 0);
    const costoFifoReferencia = costoFifoReferenciaCompleto ? lineas.reduce((total, l) => total + (l.costo_fifo_referencia ?? 0), 0) : null;
    const precio = num(p.precio_venta);
    const margen = costo != null && precio != null ? precio - costo : null;
    const margenFifo = costoFifo != null && precio != null ? precio - costoFifo : null;
    return {
      id: Number(p.id), nombre: p.nombre, seccion: seccionMenu(p.nombre), orden: ORDEN_NORMALIZADO.get(normalizarMenu(p.nombre)) ?? 9999,
      precio_venta: precio, costo_receta: costo, margen_unitario: margen,
      food_cost_pct: costo != null && precio && precio > 0 ? (costo / precio) * 100 : null,
      costo_fifo_actual: costoFifo, margen_fifo_actual: margenFifo,
      food_cost_fifo_pct: costoFifo != null && precio && precio > 0 ? (costoFifo / precio) * 100 : null,
      costo_fifo_referencia: costoFifoReferencia,
      margen_fifo_referencia: costoFifoReferencia != null && precio != null ? precio - costoFifoReferencia : null,
      food_cost_fifo_referencia_pct: costoFifoReferencia != null && precio && precio > 0 ? (costoFifoReferencia / precio) * 100 : null,
      fifo_referencia_disponible: costoFifoCompleto,
      fifo_disponible: costoFifoCompleto, receta_id: receta ? Number(receta.id) : null, version: receta?.version ?? null,
      estado: receta?.estado ?? 'sin_receta', completa: !!receta && lineas.length > 0 && lineas.every((l) => l.falta_configuracion.length === 0), lineas,
    };
  }).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));
  const costeados = items.filter((i) => i.costo_fifo_actual != null || i.costo_receta != null);
  const priced = items.filter((i) => i.food_cost_fifo_pct != null || i.food_cost_pct != null);
  const sections = [...new Set(items.map((i) => i.seccion))];
  res.json({ fuente: 'Lotes FIFO abiertos + receta validada (costo actual)', moneda: 'MXN', generado_at: new Date().toISOString(), resumen: { productos: items.length, costeados: costeados.length, pendientes: items.length - costeados.length, food_cost_promedio: priced.length ? priced.reduce((s, i) => s + (i.food_cost_fifo_pct ?? i.food_cost_pct ?? 0), 0) / priced.length : null, margen_promedio: priced.length ? priced.reduce((s, i) => s + (i.margen_fifo_actual ?? i.margen_unitario ?? 0), 0) / priced.length : null }, secciones: sections, productos: items });
}));

/** GET /recetas — menú, versiones y líneas; solo datos del negocio autenticado. */
recetasRouter.get('/', asyncHandler(async (req, res) => {
  const productos = await prisma.productos_menu.findMany({
    where: { negocio_id: req.auth!.negocioId },
    include: {
      recetas: {
        orderBy: { version: 'desc' },
        include: { lineas: { include: { products: { select: {
          name: true,
          unit_cost: true,
          unidad_base: true,
          contenido_compra: true,
          rendimiento_util: true,
        } } } } },
      },
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
  });
  res.json(productos.map(serialize));
}));

/** GET /recetas/insumos — catálogo disponible para construir líneas. */
recetasRouter.get('/insumos', asyncHandler(async (req, res) => {
  const productos = await prisma.products.findMany({
    where: { negocio_id: req.auth!.negocioId, active: true },
    select: {
      id: true,
      name: true,
      unit_cost: true,
      unidad_base: true,
      contenido_compra: true,
      unidad_compra: true,
      rendimiento_util: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json(productos.map((p) => ({
    id: Number(p.id),
    nombre: p.name,
    costo_unitario: num(p.unit_cost),
    unidad_base: p.unidad_base,
    contenido_compra: num(p.contenido_compra),
    unidad_compra: p.unidad_compra,
    rendimiento_util: num(p.rendimiento_util),
  })));
}));

/** POST /recetas — crea producto de menú y una nueva versión de receta. */
recetasRouter.post('/', soloAdmin, asyncHandler(async (req, res) => {
  const b = recetaBody.parse(req.body);
  const negocioId = req.auth!.negocioId;
  const ids = [...new Set(b.lineas.map((l) => l.product_id))];
  const insumos = await prisma.products.findMany({ where: { id: { in: ids.map(BigInt) }, negocio_id: negocioId, active: true }, select: { id: true } });
  if (insumos.length !== ids.length) throw new HttpError(400, 'Una o más líneas no pertenecen al catálogo activo de Ibérico.');

  const producto = await prisma.$transaction(async (tx) => {
    let menu = b.producto_menu_id == null
      ? await tx.productos_menu.findFirst({ where: { negocio_id: negocioId, nombre: b.nombre } })
      : await tx.productos_menu.findFirst({ where: { id: BigInt(b.producto_menu_id), negocio_id: negocioId } });
    if (!menu) {
      menu = await tx.productos_menu.create({ data: {
        negocio_id: negocioId,
        nombre: b.nombre,
        epos_product_id: b.epos_product_id ?? null,
        precio_venta: b.precio_venta ?? null,
      } });
    } else {
      menu = await tx.productos_menu.update({ where: { id: menu.id }, data: {
        nombre: b.nombre,
        epos_product_id: b.epos_product_id === undefined ? undefined : b.epos_product_id,
        precio_venta: b.precio_venta === undefined ? undefined : b.precio_venta,
      } });
    }
    const ultima = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const receta = await tx.recetas.create({ data: {
      producto_menu_id: menu.id,
      version: (ultima?.version ?? 0) + 1,
      estado: b.estado,
      fuente: b.fuente ?? null,
      notas: b.notas ?? null,
      vigente_desde: b.vigente_desde ? new Date(`${b.vigente_desde}T00:00:00.000Z`) : null,
      lineas: { create: b.lineas.map((l) => ({ product_id: BigInt(l.product_id), cantidad: l.cantidad, unidad: l.unidad, nota: l.nota ?? null })) },
    } });
    return { menu, receta };
  });
  res.status(201).json({ id: Number(producto.menu.id), receta_id: Number(producto.receta.id), version: producto.receta.version });
}));

/** PATCH /recetas/:id/estado — retira/reactiva una receta sin borrar historia. */
recetasRouter.patch('/:id/estado', soloAdmin, asyncHandler(async (req, res) => {
  const recetaId = BigInt(id.parse(req.params.id));
  const { estado } = z.object({ estado: z.enum(['borrador', 'validada', 'retirada']) }).parse(req.body);
  const receta = await prisma.recetas.findFirst({ where: { id: recetaId, productos_menu: { negocio_id: req.auth!.negocioId } } });
  if (!receta) throw new HttpError(404, 'Receta no encontrada');
  await prisma.recetas.update({ where: { id: recetaId }, data: { estado } });
  res.json({ ok: true });
}));
