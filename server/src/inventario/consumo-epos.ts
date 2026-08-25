import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { convertirCantidad } from '../recetas/costeo.js';
import { consumirFIFO } from './fifo.js';
import { normalizarNombreEpos } from '../epos/mapeo-menu.js';

type DbClient = Prisma.TransactionClient | PrismaClient;

interface PlanConsumo {
  estado: 'costeable' | 'excepcion' | 'pendiente' | 'ya_costeada';
  error?: string;
  costoTotal: number;
  consumos: { productId: bigint; loteId: bigint; cantidad: number; costoUnitario: number; costoTotal: number }[];
}

type CachedMenu = {
  id: bigint;
  nombre: string;
  epos_product_id: number | null;
  recetas: {
    lineas: {
      product_id: bigint;
      cantidad: Prisma.Decimal;
      unidad: string;
      products: { name: string; unidad_base: string | null };
    }[];
  }[];
};

type CachedLot = {
  id: bigint;
  product_id?: bigint;
  recibido_at: Date;
  cantidad_restante: Prisma.Decimal;
  costo_unitario: Prisma.Decimal;
  fuente: string;
};

type PlanContext = {
  menus: CachedMenu[];
  lotsByProduct: Map<string, CachedLot[]>;
  consumedVentaIds: Set<string>;
};

type ModoCosteo = 'normal' | 'historico_prueba';

/**
 * El modo histórico limita deliberadamente el costeo al libro del piloto.
 * En modo normal, si existe un lote operativo para el producto se usa ese
 * libro; si no, se conserva el saldo histórico para no crear faltantes
 * artificiales cuando el snapshot omitió una línea.
 */
function seleccionarLotesOperativos<T extends { fuente: string }>(lotes: T[], modo: ModoCosteo = 'normal') {
  if (modo === 'historico_prueba') return lotes.filter((lote) => lote.fuente === 'historico_prueba');
  const vivos = lotes.filter((lote) => lote.fuente !== 'historico_prueba');
  return vivos.length ? vivos : lotes;
}

function fechaISO(value: Date) {
  return value.toISOString().slice(0, 10);
}

function finDelDia(value: Date) {
  const fecha = fechaISO(value);
  return new Date(`${fecha}T23:59:59.999Z`);
}

async function planificar(client: DbClient, negocioId: bigint, venta: { id: bigint; epos_product_id: number | null; producto_nombre: string; cantidad: Prisma.Decimal; fecha: Date }, context?: PlanContext): Promise<PlanConsumo> {
  const previo = context
    ? context.consumedVentaIds.has(venta.id.toString())
    : await client.inventory_consumptions.findFirst({
      where: {
        negocio_id: negocioId,
        epos_venta_id: venta.id,
        cantidad: { gt: 0 },
        OR: [{ fuente: { startsWith: 'venta_fifo_vivo' } }, { fuente: 'venta_receta' }],
      },
      select: { id: true },
    });
  if (previo) return { estado: 'ya_costeada', costoTotal: 0, consumos: [] };

  const includeReceta = {
    recetas: {
      where: { estado: 'validada', OR: [{ vigente_desde: null }, { vigente_desde: { lte: venta.fecha } }] },
      orderBy: { version: 'desc' as const },
      take: 1,
      include: { lineas: { include: { products: { select: { id: true, name: true, unidad_base: true } } } } },
    },
  };
  // El ID es la relación primaria. Sólo si no existe una asociación por ID se
  // permite el respaldo por nombre exacto; un OR podía elegir otro menú de
  // forma no determinista cuando el nombre coincidía.
  const menuPorId = context
    ? (venta.epos_product_id == null ? null : context.menus.find((candidate) => candidate.epos_product_id === venta.epos_product_id) ?? null)
    : venta.epos_product_id == null ? null : await client.productos_menu.findFirst({
      where: { negocio_id: negocioId, activo: true, epos_product_id: venta.epos_product_id },
      include: includeReceta,
    });
  const menuExacto = menuPorId ?? (context
    ? context.menus.find((candidate) => candidate.nombre === venta.producto_nombre) ?? null
    : await client.productos_menu.findFirst({
      where: { negocio_id: negocioId, activo: true, nombre: venta.producto_nombre },
      include: includeReceta,
    }));
  const menu = menuExacto ?? (context
    ? context.menus.find((candidate) => normalizarNombreEpos(candidate.nombre) === normalizarNombreEpos(venta.producto_nombre)) ?? null
    : (await client.productos_menu.findMany({ where: { negocio_id: negocioId, activo: true }, include: includeReceta })).find((candidate) => normalizarNombreEpos(candidate.nombre) === normalizarNombreEpos(venta.producto_nombre)) ?? null);
  if (!menu) return { estado: 'excepcion', error: `Producto Epos sin mapeo: ${venta.producto_nombre}`, costoTotal: 0, consumos: [] };
  const receta = menu.recetas[0];
  // Una receta todavía no validada es un pendiente de configuración, no una
  // excepción operativa. Las excepciones deben reservarse para un mapeo
  // inexistente o una existencia FIFO realmente insuficiente.
  if (!receta) return { estado: 'pendiente', error: `Receta validada pendiente: ${menu.nombre}`, costoTotal: 0, consumos: [] };
  if (!receta.lineas.length) return { estado: 'pendiente', error: `Receta sin ingredientes: ${menu.nombre}`, costoTotal: 0, consumos: [] };

  const cantidadVendida = Number(venta.cantidad);
  if (!Number.isFinite(cantidadVendida) || cantidadVendida <= 0) return { estado: 'excepcion', error: `Cantidad inválida en venta: ${menu.nombre}`, costoTotal: 0, consumos: [] };

  const consumos: PlanConsumo['consumos'] = [];
  for (const linea of receta.lineas) {
    const unidadBase = linea.products.unidad_base;
    const cantidadBase = unidadBase ? convertirCantidad(Number(linea.cantidad) * cantidadVendida, linea.unidad, unidadBase) : null;
    if (cantidadBase == null) {
      return { estado: 'pendiente', error: `Unidad pendiente en ${menu.nombre}: ${linea.products.name} (${linea.unidad} → ${unidadBase ?? 'sin unidad'})`, costoTotal: 0, consumos: [] };
    }
    // Un lote sólo puede cubrir ventas posteriores a su recepción. Esto evita
    // que una compra capturada con fecha futura tape artificialmente un faltante
    // histórico cuando el costeo se reintenta en vivo.
    const lotes = context
      ? seleccionarLotesOperativos((context.lotsByProduct.get(linea.product_id.toString()) ?? []).filter((lote) => lote.recibido_at <= finDelDia(venta.fecha)))
      : seleccionarLotesOperativos(await client.inventory_lots.findMany({
        where: { negocio_id: negocioId, product_id: linea.product_id, estado: 'abierto', cantidad_restante: { gt: 0 }, recibido_at: { lte: finDelDia(venta.fecha) } },
        orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
        select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true, fuente: true },
      }));
    const resultado = consumirFIFO(lotes.map((lote) => ({
      id: Number(lote.id), recibidoAt: fechaISO(lote.recibido_at), cantidadRestante: Number(lote.cantidad_restante), costoUnitario: Number(lote.costo_unitario),
    })), cantidadBase);
    if (resultado.faltante > 0.0001) {
      return { estado: 'excepcion', error: `Inventario insuficiente: ${linea.products.name}; faltan ${resultado.faltante} ${unidadBase}`, costoTotal: 0, consumos: [] };
    }
    consumos.push(...resultado.consumos.map((c) => ({ productId: linea.product_id, loteId: BigInt(c.loteId), cantidad: c.cantidad, costoUnitario: c.costoUnitario, costoTotal: c.costoTotal })));
  }
  return { estado: 'costeable', costoTotal: Number(consumos.reduce((sum, c) => sum + c.costoTotal, 0).toFixed(4)), consumos };
}

async function cargarContexto(client: DbClient, negocioId: bigint, ventas: { id: bigint }[], modo: ModoCosteo = 'normal'): Promise<PlanContext> {
  const menus = await client.productos_menu.findMany({
    where: { negocio_id: negocioId, activo: true },
    select: {
      id: true, nombre: true, epos_product_id: true,
      recetas: {
        where: { estado: 'validada' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { lineas: { select: { product_id: true, cantidad: true, unidad: true, products: { select: { name: true, unidad_base: true } } } } },
      },
    },
  }) as CachedMenu[];
  const productIds = [...new Set(menus.flatMap((menu) => menu.recetas[0]?.lineas.map((linea) => linea.product_id.toString()) ?? []))].map(BigInt);
  const lots = productIds.length ? await client.inventory_lots.findMany({
    where: {
      negocio_id: negocioId,
      product_id: { in: productIds },
      estado: 'abierto',
      cantidad_restante: { gt: 0 },
    },
    orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }],
    select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true, fuente: true },
  }) : [];
  const consumed = await client.inventory_consumptions.findMany({
    where: {
      negocio_id: negocioId,
      epos_venta_id: { in: ventas.map((venta) => venta.id) },
      cantidad: { gt: 0 },
      OR: [{ fuente: { startsWith: 'venta_fifo_vivo' } }, { fuente: 'venta_receta' }],
    },
    select: { epos_venta_id: true },
  });
  const lotsByProduct = new Map<string, CachedLot[]>();
  for (const lot of lots) {
    const list = lotsByProduct.get(lot.product_id.toString()) ?? [];
    list.push(lot);
    lotsByProduct.set(lot.product_id.toString(), list);
  }
  for (const [key, list] of lotsByProduct) lotsByProduct.set(key, seleccionarLotesOperativos(list, modo));
  return { menus, lotsByProduct, consumedVentaIds: new Set(consumed.flatMap((row) => row.epos_venta_id == null ? [] : [row.epos_venta_id.toString()])) };
}

function aplicarPlanEnMemoria(context: PlanContext, plan: PlanConsumo) {
  for (const consumo of plan.consumos) {
    const lote = context.lotsByProduct.get(consumo.productId.toString())?.find((candidate) => candidate.id === consumo.loteId);
    if (lote) lote.cantidad_restante = new Prisma.Decimal(Number(lote.cantidad_restante) - consumo.cantidad);
  }
}

/** Calcula o aplica consumo FIFO para ventas Epos ya importadas. */
export async function consumirVentasEpos(input: { negocioId: bigint; from: string; to: string; confirmar: boolean; modo?: ModoCosteo }) {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new HttpError(400, 'Periodo inválido');
  // Igual que el detalle de ventas, el costeo debe respetar el periodo
  // operativo de la importación. Así no se pierden tickets después de
  // medianoche que pertenecen al cierre del día anterior.
  const importaciones = await prisma.epos_importaciones.findMany({
    where: { negocio_id: input.negocioId, periodo_desde: from, periodo_hasta: to },
    select: { id: true },
  });
  const ventas = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: input.negocioId,
      ...(importaciones.length ? { importacion_id: { in: importaciones.map((row) => row.id) } } : { fecha: { gte: from, lt: to } }),
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });
  const resultado = { periodo: { from: input.from, to: input.to }, confirmar: input.confirmar, ventas: ventas.length, costeadas: 0, excepciones: 0, pendientes: 0, ya_costeadas: 0, costo_fifo: 0, detalle: [] as Record<string, unknown>[] };
  const modo = input.modo ?? 'normal';
  const context = await cargarContexto(prisma, input.negocioId, ventas, modo);
  const planes = [] as { venta: typeof ventas[number]; plan: PlanConsumo }[];
  for (const venta of ventas) {
    const plan = await planificar(prisma, input.negocioId, venta, context);
    planes.push({ venta, plan });
      if (plan.estado === 'costeable') aplicarPlanEnMemoria(context, plan);
  }

  if (input.confirmar) {
    const costeables = planes.filter(({ plan }) => plan.estado === 'costeable');
    const excepciones = planes.filter(({ plan }) => plan.estado === 'excepcion');
    const pendientes = planes.filter(({ plan }) => plan.estado === 'pendiente');
    const lotes = new Map<string, number>();
    for (const { plan } of costeables) {
      for (const consumo of plan.consumos) lotes.set(consumo.loteId.toString(), (lotes.get(consumo.loteId.toString()) ?? 0) + consumo.cantidad);
    }
    const consumos = costeables.flatMap(({ venta, plan }) => plan.consumos.map((consumo) => ({
      negocio_id: input.negocioId,
      product_id: consumo.productId,
      lote_id: consumo.loteId,
      epos_venta_id: venta.id,
      fecha: venta.fecha,
      cantidad: consumo.cantidad,
      costo_unitario: consumo.costoUnitario,
      costo_total: consumo.costoTotal,
      fuente: modo === 'historico_prueba' ? 'venta_receta_historica' : 'venta_receta',
    })));

    await prisma.$transaction(async (tx) => {
      if (lotes.size) {
        const entradas = [...lotes.entries()];
        const params = entradas.flatMap(([id, cantidad]) => [id, cantidad]);
        const values = entradas.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::numeric)`).join(',');
        const actualizados = await tx.$executeRawUnsafe(
          `UPDATE inventory_lots AS l SET cantidad_restante = l.cantidad_restante - v.cantidad
           FROM (VALUES ${values}) AS v(id, cantidad)
           WHERE l.id = v.id AND l.negocio_id = $${params.length + 1}::bigint
             AND l.cantidad_restante >= v.cantidad`,
          ...params, input.negocioId.toString(),
        );
        if (actualizados !== entradas.length) throw new HttpError(409, 'El lote FIFO cambió mientras se procesaba; reintenta el costeo');
        const ids = entradas.map(([id]) => id).map((id) => `'${id.replaceAll("'", "''")}'`).join(',');
        await tx.$executeRawUnsafe(`UPDATE inventory_lots SET estado = 'agotado' WHERE negocio_id = $1::bigint AND id IN (${ids}) AND cantidad_restante <= 0`, input.negocioId.toString());
      }
      if (consumos.length) await tx.inventory_consumptions.createMany({ data: consumos });
      if (costeables.length) {
        const params = costeables.flatMap(({ venta, plan }) => [venta.id.toString(), plan.costoTotal]);
        const values = costeables.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::numeric)`).join(',');
        await tx.$executeRawUnsafe(
          `UPDATE epos_ventas AS e SET costo_fifo = v.costo, costeo_estado = 'costeada', costeo_error = NULL, costeado_at = NOW()
           FROM (VALUES ${values}) AS v(id, costo) WHERE e.id = v.id AND e.negocio_id = $${params.length + 1}::bigint`,
          ...params, input.negocioId.toString(),
        );
      }
      if (excepciones.length) {
        const params = excepciones.flatMap(({ venta, plan }) => [venta.id.toString(), plan.error ?? 'Excepción de costeo']);
        const values = excepciones.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::text)`).join(',');
        await tx.$executeRawUnsafe(
          `UPDATE epos_ventas AS e SET costeo_estado = 'excepcion', costeo_error = v.error
           FROM (VALUES ${values}) AS v(id, error) WHERE e.id = v.id AND e.negocio_id = $${params.length + 1}::bigint`,
          ...params, input.negocioId.toString(),
        );
      }
      // Limpia estados antiguos que se marcaron como excepción antes de que
      // distinguiéramos configuración pendiente de una excepción real.
      if (pendientes.length) {
        const params = pendientes.flatMap(({ venta, plan }) => [venta.id.toString(), plan.error ?? 'Pendiente de configuración']);
        const values = pendientes.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::text)`).join(',');
        await tx.$executeRawUnsafe(
          `UPDATE epos_ventas AS e SET costeo_estado = 'pendiente', costeo_error = v.error
           FROM (VALUES ${values}) AS v(id, error) WHERE e.id = v.id AND e.negocio_id = $${params.length + 1}::bigint`,
          ...params, input.negocioId.toString(),
        );
      }
    }, { maxWait: 60_000, timeout: 300_000 });
  }

  for (const { venta, plan } of planes) {
    if (plan.estado === 'costeable') { resultado.costeadas += 1; resultado.costo_fifo += plan.costoTotal; }
    else if (plan.estado === 'ya_costeada') resultado.ya_costeadas += 1;
    else if (plan.estado === 'excepcion') resultado.excepciones += 1;
    else resultado.pendientes += 1;
    resultado.detalle.push({ venta_id: Number(venta.id), producto: venta.producto_nombre, estado: plan.estado, costo_fifo: plan.costoTotal, error: plan.error ?? null });
  }
  resultado.costo_fifo = Number(resultado.costo_fifo.toFixed(4));
  return resultado;
}

/**
 * Reprocesa únicamente ventas que todavía no tienen un costo válido.
 *
 * El libro FIFO es continuo: las compras nuevas pueden resolver una venta
 * pendiente siempre que el lote tenga fecha de recepción anterior o igual a
 * la venta. Las ventas ya costeadas conservan sus consumos inmutables.
 */
export async function costearVentasPendientesEnVivo(input: {
  negocioId: bigint;
  from?: Date;
  to?: Date;
}) {
  const pendientes = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: input.negocioId,
      costeo_estado: { in: ['pendiente', 'excepcion'] },
      ...(input.from || input.to ? { fecha: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } } : {}),
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    select: { fecha: true },
  });
  if (!pendientes.length) return { ventas: 0, costeadas: 0, excepciones: 0, pendientes: 0, costo_fifo: 0 };
  const primera = pendientes[0]!;
  const ultima = pendientes[pendientes.length - 1]!;
  const from = input.from ?? primera.fecha;
  const to = input.to ?? new Date(ultima.fecha.getTime() + 1);
  const resultado = await consumirVentasEpos({
    negocioId: input.negocioId,
    from: from.toISOString(),
    to: to.toISOString(),
    confirmar: true,
    modo: 'normal',
  });
  return {
    ventas: resultado.ventas,
    costeadas: resultado.costeadas,
    excepciones: resultado.excepciones,
    pendientes: resultado.pendientes,
    costo_fifo: resultado.costo_fifo,
  };
}

/** Snapshot operativo del ledger continuo. No cambia lotes ni ventas. */
export async function estadoFifoEnVivo(negocioId: bigint) {
  const [lotes, pendientes, excepciones] = await Promise.all([
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, estado: 'abierto', cantidad_restante: { gt: 0 } },
      select: { product_id: true, cantidad_restante: true, costo_unitario: true, fuente: true },
    }),
    prisma.epos_ventas.count({ where: { negocio_id: negocioId, costeo_estado: 'pendiente' } }),
    prisma.epos_ventas.count({ where: { negocio_id: negocioId, costeo_estado: 'excepcion' } }),
  ]);
  const seleccionados = [...new Set(lotes.map((lote) => lote.product_id.toString()))]
    .flatMap((productId) => seleccionarLotesOperativos(lotes.filter((lote) => lote.product_id.toString() === productId)));
  const valor = seleccionados.reduce((sum, lote) => sum + Number(lote.cantidad_restante) * Number(lote.costo_unitario), 0);
  return {
    lotes_abiertos: seleccionados.length,
    unidades_base_abiertas: seleccionados.reduce((sum, lote) => sum + Number(lote.cantidad_restante), 0),
    valor_fifo_abierto: Number(valor.toFixed(4)),
    ventas_pendientes: pendientes,
    ventas_excepcion: excepciones,
    costeo: 'en_vivo',
  };
}

/**
 * Valora el libro FIFO a una fecha de corte. Se reconstruye desde los lotes
 * y el ledger inmutable de consumos para que una semana posterior no borre ni
 * reinicie la existencia de las semanas anteriores.
 */
export async function valorFifoAlCorte(negocioId: bigint, fechaCorte: Date, modo: ModoCosteo = 'normal') {
  const lotes = await prisma.inventory_lots.findMany({
    where: {
      negocio_id: negocioId,
      recibido_at: { lte: fechaCorte },
      estado: { in: ['abierto', 'agotado'] },
      ...(modo === 'historico_prueba' ? { fuente: 'historico_prueba' as const } : {}),
    },
    select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true, fuente: true },
  });
  const lotesSeleccionados = [...new Set(lotes.map((lote) => lote.product_id.toString()))]
    .flatMap((productId) => seleccionarLotesOperativos(lotes.filter((lote) => lote.product_id.toString() === productId), modo));
  if (!lotesSeleccionados.length) return { valor: 0, unidades: 0, lotes: 0 };
  const consumos = await prisma.inventory_consumptions.findMany({
    where: { negocio_id: negocioId, fecha: { lte: fechaCorte }, lote_id: { in: lotesSeleccionados.map((lote) => lote.id) } },
    select: { lote_id: true, cantidad: true },
  });
  const consumido = new Map<string, number>();
  for (const consumo of consumos) {
    const key = consumo.lote_id.toString();
    consumido.set(key, (consumido.get(key) ?? 0) + Number(consumo.cantidad));
  }
  let unidades = 0;
  let valor = 0;
  let lotesConSaldo = 0;
  for (const lote of lotesSeleccionados) {
    const restante = Math.max(0, Number(lote.cantidad_inicial) - (consumido.get(lote.id.toString()) ?? 0));
    if (restante <= 0.0001) continue;
    lotesConSaldo += 1;
    unidades += restante;
    valor += restante * Number(lote.costo_unitario);
  }
  return {
    valor: Number(valor.toFixed(4)),
    unidades: Number(unidades.toFixed(4)),
    lotes: lotesConSaldo,
  };
}
