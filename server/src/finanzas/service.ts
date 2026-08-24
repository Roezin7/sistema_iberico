import type { TipoMovimiento } from '@prisma/client';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import {
  comisionTerminal,
  calcularSaldosTeoricos,
  descuadre,
  resumenSemana,
  costoVentasPorInventario,
  capitalSocio,
  redondear,
  REGLAS_MOVIMIENTO,
  mesesRecientes,
  estadoResultadosMensual,
  totalizarPnl,
  type MovBalance,
  type InventarioMes,
} from './logic.js';
import { generarSnapshotEnCierre } from '../patrimonio/service.js';
import { inventarioActual, crearSnapshotConsolidado, valorSnapshot } from '../inventario/service.js';
import { valorFifoAlCorte } from '../inventario/consumo-epos.js';

// --- Fechas (semana lunes→domingo) -----------------------------------------
function lunesDe(fecha: Date): Date {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dow = d.getUTCDay(); // 0=domingo
  const diff = (dow === 0 ? -6 : 1) - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}
function masDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
//  Referencias para la UI
// ---------------------------------------------------------------------------
export async function referencias(negocioId: bigint) {
  const [ubicaciones, categorias, socios] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { id: 'asc' } }),
    prisma.categorias_gasto.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { nombre: 'asc' } }),
    prisma.socios.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { nombre: 'asc' } }),
  ]);
  return {
    ubicaciones: ubicaciones.map((u) => ({ id: Number(u.id), nombre: u.nombre, tipo: u.tipo, socio_id: u.socio_id ? Number(u.socio_id) : null })),
    categorias: categorias.map((c) => ({ id: Number(c.id), nombre: c.nombre })),
    socios: socios.map((s) => ({ id: Number(s.id), nombre: s.nombre })),
    reglas: REGLAS_MOVIMIENTO,
  };
}

// ---------------------------------------------------------------------------
//  Saldos iniciales (bootstrap, una sola vez)
// ---------------------------------------------------------------------------
export async function getSaldosIniciales(negocioId: bigint) {
  const filas = await prisma.saldos_iniciales.findMany({ where: { negocio_id: negocioId } });
  return filas.map((f) => ({ ubicacion_id: Number(f.ubicacion_id), monto: num0(f.monto) }));
}

export async function fijarSaldosIniciales(negocioId: bigint, saldos: { ubicacion_id: number; monto: number }[]) {
  const existentes = await prisma.saldos_iniciales.count({ where: { negocio_id: negocioId } });
  if (existentes > 0) {
    throw new HttpError(409, 'Los saldos iniciales ya se fijaron y no son editables');
  }
  const ubic = await prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId }, select: { id: true } });
  const validas = new Set(ubic.map((u) => u.id.toString()));
  for (const s of saldos) {
    if (!validas.has(s.ubicacion_id.toString())) throw new HttpError(400, `Ubicación ${s.ubicacion_id} inválida`);
  }
  await prisma.saldos_iniciales.createMany({
    data: saldos.map((s) => ({ negocio_id: negocioId, ubicacion_id: BigInt(s.ubicacion_id), monto: s.monto })),
  });
  return getSaldosIniciales(negocioId);
}

/** Mapa ubicacion_id -> saldo inicial de la semana dada (de cierre previo, o bootstrap). */
async function mapaSaldoInicial(negocioId: bigint, fechaInicio: Date): Promise<Record<number, number>> {
  const prev = await prisma.semanas.findFirst({
    where: { negocio_id: negocioId, estado: 'cerrada', fecha_inicio: { lt: fechaInicio } },
    orderBy: { fecha_inicio: 'desc' },
    include: { cierres: true },
  });
  const map: Record<number, number> = {};
  if (prev && prev.cierres.length > 0) {
    for (const c of prev.cierres) map[Number(c.ubicacion_id)] = num0(c.saldo_final);
  } else {
    const boot = await prisma.saldos_iniciales.findMany({ where: { negocio_id: negocioId } });
    for (const b of boot) map[Number(b.ubicacion_id)] = num0(b.monto);
  }
  return map;
}

// ---------------------------------------------------------------------------
//  Semanas
// ---------------------------------------------------------------------------
export async function listarSemanas(negocioId: bigint) {
  const semanas = await prisma.semanas.findMany({ where: { negocio_id: negocioId }, orderBy: { fecha_inicio: 'desc' } });
  return semanas.map(serializarSemana);
}

export async function semanaActual(negocioId: bigint) {
  const s = await prisma.semanas.findFirst({ where: { negocio_id: negocioId, estado: 'abierta' }, orderBy: { fecha_inicio: 'desc' } });
  return s ? serializarSemana(s) : null;
}

export async function crearSemana(negocioId: bigint, fechaInicioStr?: string) {
  let inicio: Date;
  if (fechaInicioStr) {
    inicio = lunesDe(new Date(fechaInicioStr + 'T00:00:00Z'));
  } else {
    // Sin fecha explícita: continúa la cadena desde la última semana existente (abierta o
    // cerrada), no desde "hoy" — así nunca se salta una semana aunque se abra tarde.
    const ultima = await prisma.semanas.findFirst({ where: { negocio_id: negocioId }, orderBy: { fecha_inicio: 'desc' } });
    inicio = ultima ? masDias(ultima.fecha_fin, 1) : lunesDe(new Date());
  }
  const fin = masDias(inicio, 6);
  const existe = await prisma.semanas.findFirst({ where: { negocio_id: negocioId, fecha_inicio: inicio } });
  if (existe) throw new HttpError(409, 'Esa semana ya existe');
  const s = await prisma.semanas.create({
    data: {
      negocio_id: negocioId,
      // La etiqueta se normaliza después de crear la semana para conservar un
      // valor legible también en consultas directas a la base.
      etiqueta: 'Semana',
      fecha_inicio: inicio,
      fecha_fin: fin,
    },
  });
  const actualizado = await prisma.semanas.update({
    where: { id: s.id },
    data: { etiqueta: etiquetaCanonica(inicio, fin) },
  });
  await asegurarInventarioSemanal(negocioId, actualizado.id);
  return serializarSemana(actualizado);
}

// La numeración de semana es una convención operativa, no el ID interno de
// PostgreSQL. Algunos registros históricos fueron importados fuera de orden,
// por lo que usar `id` produce etiquetas como "Semana 14" después de la 64.
// El ancla corresponde a la semana operativa vigente al introducir esta
// normalización; las semanas futuras e históricas se calculan hacia delante o
// atrás desde ella.
const SEMANA_ANCLA_FECHA = Date.UTC(2026, 7, 17); // lunes 17-ago-2026
const SEMANA_ANCLA_NUMERO = 64;

function numeroSemanaOperativa(inicio: Date): number {
  const fecha = Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate());
  const semanasDesdeAncla = Math.round((fecha - SEMANA_ANCLA_FECHA) / (7 * 24 * 60 * 60 * 1000));
  return SEMANA_ANCLA_NUMERO + semanasDesdeAncla;
}

export function etiquetaCanonica(inicio: Date, fin: Date) {
  const inicioNumero = numeroSemanaOperativa(inicio);
  const dias = Math.round((Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate()) -
    Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate())) / (24 * 60 * 60 * 1000)) + 1;
  const semanasCubiertas = Math.max(1, Math.round(dias / 7));
  const numero = semanasCubiertas > 1
    ? `${inicioNumero}–${inicioNumero + semanasCubiertas - 1}`
    : `${inicioNumero}`;
  return `Semana ${numero} (${iso(inicio)} → ${iso(fin)})`;
}

function serializarSemana(s: { id: bigint; etiqueta: string; fecha_inicio: Date; fecha_fin: Date; estado: string; cerrada_at: Date | null }) {
  return {
    id: Number(s.id),
    // No dependemos de etiquetas históricas inconsistentes ("- Mayo", fechas
    // sueltas o puentes). La API siempre entrega una etiqueta homogénea.
    etiqueta: etiquetaCanonica(s.fecha_inicio, s.fecha_fin),
    fecha_inicio: iso(s.fecha_inicio),
    fecha_fin: iso(s.fecha_fin),
    estado: s.estado,
    cerrada_at: s.cerrada_at ? s.cerrada_at.toISOString() : null,
  };
}

async function getSemanaAbierta(negocioId: bigint, semanaId: bigint) {
  const s = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!s) throw new HttpError(404, 'Semana no encontrada');
  return s;
}

/**
 * Garantiza que una semana tenga una apertura de inventario explícita. Para
 * semanas nuevas se toma el cierre de la semana anterior; durante la
 * migración se permite usar el último conteo histórico como bootstrap.
 */
async function asegurarInventarioSemanal(negocioId: bigint, semanaId: bigint) {
  const existente = await prisma.inventario_semanal.findUnique({ where: { semana_id: semanaId } });
  if (existente) return existente;

  const semana = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');

  const anterior = await prisma.semanas.findFirst({
    where: { negocio_id: negocioId, fecha_fin: { lt: semana.fecha_inicio } },
    orderBy: { fecha_inicio: 'desc' },
    include: { inventario_semanal: true },
  });
  let aperturaSnapshotId = anterior?.inventario_semanal?.cierre_snapshot_id ?? null;
  let aperturaOrigen = aperturaSnapshotId ? 'cierre_semana_anterior' : null;

  if (!aperturaSnapshotId) {
    const limite = new Date(semana.fecha_inicio);
    limite.setUTCDate(limite.getUTCDate() + 1);
    const ultimo = await prisma.inventory_snapshot.findFirst({
      where: { negocio_id: negocioId, created_at: { lt: limite } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    aperturaSnapshotId = ultimo?.id ?? null;
    aperturaOrigen = aperturaSnapshotId ? 'conteo_historico_bootstrap' : null;
  }

  const aperturaValor = aperturaSnapshotId ? await valorSnapshot(negocioId, aperturaSnapshotId) : null;
  return prisma.inventario_semanal.create({
    data: {
      negocio_id: negocioId,
      semana_id: semanaId,
      apertura_snapshot_id: aperturaSnapshotId,
      apertura_valor: aperturaValor,
      apertura_origen: aperturaOrigen,
    },
  });
}

async function inventarioDeSemana(negocioId: bigint, semanaId: bigint) {
  const semanal = await asegurarInventarioSemanal(negocioId, semanaId);
  const semana = await prisma.semanas.findUnique({ where: { id: semanaId }, select: { fecha_inicio: true, fecha_fin: true } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  const [movs, fifoCorte, consumosPeriodo] = await Promise.all([
    prisma.movimientos.findMany({
      where: { negocio_id: negocioId, semana_id: semanaId, tipo: 'compra_inventario' },
      select: { monto: true },
    }),
    valorFifoAlCorte(negocioId, semana.fecha_fin),
    prisma.inventory_consumptions.aggregate({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: semana.fecha_fin }, epos_venta_id: { not: null } },
      _sum: { costo_total: true },
      _count: { _all: true },
    }),
  ]);
  const compras = redondear(movs.reduce((a, m) => a + num0(m.monto), 0));
  const apertura = semanal.apertura_valor == null ? null : num0(semanal.apertura_valor);
  // El valor FIFO al corte es una valuación del libro, no un conteo físico.
  // Nunca debe presentarse como cierre de inventario mientras la semana no
  // tenga un snapshot de cierre vinculado.
  const cierreRegistrado = semanal.cierre_snapshot_id == null || semanal.cierre_valor == null
    ? null
    : num0(semanal.cierre_valor);
  const costoVentasLedger = consumosPeriodo._count._all > 0 ? num0(consumosPeriodo._sum.costo_total) : null;
  const costoVentas = costoVentasLedger ?? costoVentasPorInventario(apertura, compras, cierreRegistrado);
  return {
    apertura_snapshot_id: semanal.apertura_snapshot_id == null ? null : Number(semanal.apertura_snapshot_id),
    cierre_snapshot_id: semanal.cierre_snapshot_id == null ? null : Number(semanal.cierre_snapshot_id),
    apertura_valor: apertura,
    compras,
    cierre_valor: cierreRegistrado,
    costo_ventas: costoVentas,
    costo_ventas_fuente: costoVentasLedger == null ? 'conciliacion_inventario' : 'ledger_fifo_en_vivo',
    valor_fifo_corte: fifoCorte.valor,
    unidades_fifo_corte: fifoCorte.unidades,
    estado: semanal.cierre_snapshot_id == null ? 'pendiente_cierre' : 'cerrado',
    apertura_origen: semanal.apertura_origen,
  };
}

type EstadoConciliacionInventario = 'pendiente_cierre' | 'calculada';

interface FilaConciliacionInventario {
  product_id: number;
  producto: string;
  unidad_base: string | null;
  inventario_inicial: number;
  compras_recibidas: number;
  ajustes_inventario: number;
  consumo_teorico: number;
  existencia_fifo_esperada: number;
  inventario_fisico_final: number;
  diferencia_cantidad: number;
  costo_fifo: number | null;
  diferencia_valor: number | null;
  incidencia: string;
}

/**
 * Compara, producto por producto, el libro FIFO con el último conteo físico
 * de la semana. La cantidad teórica se calcula como apertura + compras −
 * consumo de recetas. La causa de una diferencia es una hipótesis operativa,
 * no una conclusión automática: el usuario debe revisar la evidencia.
 */
async function conciliacionInventarioSemana(negocioId: bigint, semanaId: bigint) {
  const semanal = await asegurarInventarioSemanal(negocioId, semanaId);
  const base = {
    estado: (semanal.cierre_snapshot_id == null ? 'pendiente_cierre' : 'calculada') as EstadoConciliacionInventario,
    apertura_snapshot_id: semanal.apertura_snapshot_id == null ? null : Number(semanal.apertura_snapshot_id),
    cierre_snapshot_id: semanal.cierre_snapshot_id == null ? null : Number(semanal.cierre_snapshot_id),
    filas: [] as FilaConciliacionInventario[],
    total_diferencia_valor: null as number | null,
    productos_con_incidencia: 0,
  };
  if (!semanal.apertura_snapshot_id || !semanal.cierre_snapshot_id) return base;

  const semana = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId }, select: { fecha_inicio: true, fecha_fin: true } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');

  const [productos, aperturaLineas, cierreLineas, comprasLotes, ajustesLotes, lotesLedger, consumos, consumosLedger, consumosAjuste] = await Promise.all([
    prisma.products.findMany({ where: { negocio_id: negocioId, active: true }, select: { id: true, name: true, unidad_base: true, unit_cost: true } }),
    prisma.inventory_lines.findMany({ where: { snapshot_id: semanal.apertura_snapshot_id }, select: { product_id: true, qty_captura: true, factor: true } }),
    prisma.inventory_lines.findMany({ where: { snapshot_id: semanal.cierre_snapshot_id }, select: { product_id: true, qty_captura: true, factor: true } }),
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, purchase_id: { not: null }, recibido_at: { gte: semana.fecha_inicio, lte: semana.fecha_fin } },
      select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
    }),
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, fuente: 'ajuste_inventario', ticket_ref: { startsWith: `AJUSTE-INVENTARIO-${semanaId}-` } },
      select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
    }),
    // FIFO es un libro continuo. No lo reiniciamos al cambiar de semana:
    // todos los lotes recibidos hasta el cierre participan en la existencia
    // esperada, incluidos los lotes históricos y los que cruzan semanas.
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, recibido_at: { lte: semana.fecha_fin }, estado: { in: ['abierto', 'agotado'] } },
      select: { id: true, product_id: true, recibido_at: true, cantidad_inicial: true, costo_unitario: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: semana.fecha_fin } },
      select: { product_id: true, lote_id: true, cantidad: true, fuente: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { lte: semana.fecha_fin } },
      select: { product_id: true, lote_id: true, cantidad: true, fuente: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: semana.fecha_fin }, fuente: 'ajuste_inventario' },
      select: { product_id: true, cantidad: true },
    }),
  ]);

  const redondearCantidad = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;

  const acumularLineas = (lineas: { product_id: bigint; qty_captura: unknown; factor: unknown }[]) => {
    const mapa = new Map<string, number>();
    for (const linea of lineas) {
      const key = linea.product_id.toString();
      mapa.set(key, redondearCantidad((mapa.get(key) ?? 0) + num0(linea.qty_captura as never) * num0(linea.factor as never)));
    }
    return mapa;
  };
  const iniciales = acumularLineas(aperturaLineas);
  const finales = acumularLineas(cierreLineas);
  const compras = new Map<string, number>();
  for (const lote of comprasLotes) {
    const key = lote.product_id.toString();
    compras.set(key, redondearCantidad((compras.get(key) ?? 0) + num0(lote.cantidad_inicial)));
  }
  const ajustes = new Map<string, number>();
  for (const lote of ajustesLotes) {
    const key = lote.product_id.toString();
    ajustes.set(key, redondearCantidad((ajustes.get(key) ?? 0) + num0(lote.cantidad_inicial)));
  }
  for (const consumo of consumosAjuste) {
    const key = consumo.product_id.toString();
    ajustes.set(key, redondearCantidad((ajustes.get(key) ?? 0) - num0(consumo.cantidad)));
  }
  const consumosPorProducto = new Map<string, number>();
  for (const consumo of consumos) {
    const cantidad = num0(consumo.cantidad);
    if (consumo.fuente === 'ajuste_inventario') continue;
    const productoKey = consumo.product_id.toString();
    consumosPorProducto.set(productoKey, redondearCantidad((consumosPorProducto.get(productoKey) ?? 0) + cantidad));
  }
  const consumosLedgerPorLote = new Map<string, number>();
  for (const consumo of consumosLedger) {
    const loteKey = consumo.lote_id.toString();
    consumosLedgerPorLote.set(loteKey, redondearCantidad((consumosLedgerPorLote.get(loteKey) ?? 0) + num0(consumo.cantidad)));
  }
  const lotesPorProducto = new Map<string, { id: bigint; cantidad: number; costo: number }[]>();
  for (const lote of lotesLedger) {
    const key = lote.product_id.toString();
    const lista = lotesPorProducto.get(key) ?? [];
    lista.push({ id: lote.id, cantidad: num0(lote.cantidad_inicial), costo: num0(lote.costo_unitario) });
    lotesPorProducto.set(key, lista);
  }

  const productoPorId = new Map(productos.map((p) => [p.id.toString(), p]));
  const ids = new Set([...iniciales.keys(), ...finales.keys(), ...compras.keys(), ...ajustes.keys(), ...consumosPorProducto.keys(), ...lotesPorProducto.keys()]);
  const filas = [...ids].map((key) => {
    const producto = productoPorId.get(key);
    const inicial = redondearCantidad(iniciales.get(key) ?? 0);
    const comprasRecibidas = redondearCantidad(compras.get(key) ?? 0);
    const ajusteInventario = redondearCantidad(ajustes.get(key) ?? 0);
    const consumo = redondearCantidad(consumosPorProducto.get(key) ?? 0);
    const fisico = redondearCantidad(finales.get(key) ?? 0);
    const lotes = lotesPorProducto.get(key) ?? [];
    const costoCatalogo = producto?.unit_cost == null ? null : num0(producto.unit_cost);
    const tieneAperturaFifo = lotesLedger.some((lote) => lote.product_id.toString() === key && lote.recibido_at <= semana.fecha_inicio);
    const fifoRestante = lotes.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosLedgerPorLote.get(lote.id.toString()) ?? 0)), 0);
    const fifoValorRestante = lotes.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosLedgerPorLote.get(lote.id.toString()) ?? 0)) * lote.costo, 0);
    const esperado = redondearCantidad(fifoRestante);
    const diferencia = redondearCantidad(fisico - esperado);
    const costoPonderado = fifoRestante > 0.0001
      ? Math.round((fifoValorRestante / fifoRestante) * 1_000_000) / 1_000_000
      : lotes.length
        ? Math.round((lotes.reduce((suma, lote) => suma + lote.cantidad * lote.costo, 0) / Math.max(lotes.reduce((suma, lote) => suma + lote.cantidad, 0), 0.0001)) * 1_000_000) / 1_000_000
        : costoCatalogo;
    const incidencia = !tieneAperturaFifo && inicial > 0
      ? 'Apertura FIFO pendiente'
      : Math.abs(diferencia) <= 0.01
        ? 'Sin incidencia'
        : diferencia < 0
          ? 'Faltante físico: revisar merma, captura o receta'
          : 'Sobrante físico: revisar compra no registrada o captura';
    return {
      product_id: Number(key),
      producto: producto?.name ?? `Producto ${key}`,
      unidad_base: producto?.unidad_base ?? null,
      inventario_inicial: inicial,
      compras_recibidas: comprasRecibidas,
      ajustes_inventario: ajusteInventario,
      consumo_teorico: consumo,
      existencia_fifo_esperada: esperado,
      inventario_fisico_final: fisico,
      diferencia_cantidad: diferencia,
      costo_fifo: costoPonderado,
      diferencia_valor: costoPonderado == null ? null : redondear(diferencia * costoPonderado),
      incidencia,
    } satisfies FilaConciliacionInventario;
  }).sort((a, b) => Math.abs(b.diferencia_valor ?? b.diferencia_cantidad) - Math.abs(a.diferencia_valor ?? a.diferencia_cantidad));

  const conIncidencia = filas.filter((fila) => fila.incidencia !== 'Sin incidencia');
  return {
    ...base,
    filas,
    total_diferencia_valor: filas.some((fila) => fila.diferencia_valor != null)
      ? redondear(filas.reduce((suma, fila) => suma + (fila.diferencia_valor ?? 0), 0))
      : null,
    productos_con_incidencia: conIncidencia.length,
  };
}

// ---------------------------------------------------------------------------
//  Movimientos
// ---------------------------------------------------------------------------
export interface MovimientoInput {
  semana_id: number;
  tipo: TipoMovimiento;
  monto: number;
  fecha?: string;
  ubicacion_origen_id?: number | null;
  ubicacion_destino_id?: number | null;
  categoria_id?: number | null;
  socio_id?: number | null;
  facturado?: boolean;
  descripcion?: string;
}

export async function crearMovimiento(negocioId: bigint, usuarioId: bigint, m: MovimientoInput) {
  const semana = await getSemanaAbierta(negocioId, BigInt(m.semana_id));
  if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana está cerrada; no admite movimientos');

  const regla = REGLAS_MOVIMIENTO[m.tipo];
  if (regla.autogenerado) throw new HttpError(400, 'La comisión de terminal se genera automáticamente al cerrar');
  if (m.monto <= 0) throw new HttpError(400, 'El monto debe ser mayor a cero');

  // Validar ubicaciones del negocio.
  const ubicIds = [m.ubicacion_origen_id, m.ubicacion_destino_id].filter((x): x is number => x != null);
  const ubic = ubicIds.length
    ? await prisma.ubicaciones_fondos.findMany({ where: { id: { in: ubicIds.map(BigInt) }, negocio_id: negocioId } })
    : [];
  const ubicById = new Map(ubic.map((u) => [Number(u.id), u]));
  for (const id of ubicIds) if (!ubicById.has(id)) throw new HttpError(400, `Ubicación ${id} inválida`);

  if (regla.requiereOrigen && m.ubicacion_origen_id == null) throw new HttpError(400, `${m.tipo} requiere ubicación de origen`);
  if (regla.requiereDestino && m.ubicacion_destino_id == null) throw new HttpError(400, `${m.tipo} requiere ubicación de destino`);
  if (regla.requiereCategoria && m.categoria_id == null) throw new HttpError(400, `${m.tipo} requiere categoría`);
  if (regla.requiereSocio && m.socio_id == null) throw new HttpError(400, `${m.tipo} requiere socio`);

  // Transferencia a una caja fuerte (ubicación con socio) -> exige socio.
  if (m.tipo === 'transferencia' && m.ubicacion_destino_id != null) {
    const dest = ubicById.get(m.ubicacion_destino_id)!;
    if (dest.socio_id != null && m.socio_id == null) {
      throw new HttpError(400, 'Transferencia a caja fuerte requiere indicar el socio');
    }
  }

  // facturado: por defecto true si el gasto/compra sale del Banco (tarjeta).
  let facturado = m.facturado;
  if (facturado === undefined) {
    const origen = m.ubicacion_origen_id != null ? ubicById.get(m.ubicacion_origen_id) : undefined;
    facturado = (m.tipo === 'compra_inventario' || m.tipo === 'gasto') && origen?.tipo === 'banco';
  }

  const creado = await prisma.movimientos.create({
    data: {
      negocio_id: negocioId,
      semana_id: semana.id,
      fecha: m.fecha ? new Date(m.fecha + 'T00:00:00Z') : new Date(),
      tipo: m.tipo,
      monto: m.monto,
      ubicacion_origen_id: m.ubicacion_origen_id != null ? BigInt(m.ubicacion_origen_id) : null,
      ubicacion_destino_id: m.ubicacion_destino_id != null ? BigInt(m.ubicacion_destino_id) : null,
      categoria_id: m.categoria_id != null ? BigInt(m.categoria_id) : null,
      socio_id: m.socio_id != null ? BigInt(m.socio_id) : null,
      facturado,
      descripcion: m.descripcion ?? null,
      usuario_id: usuarioId,
    },
  });
  return { id: Number(creado.id), facturado };
}

async function movimientosDeSemana(semanaId: bigint) {
  return prisma.movimientos.findMany({ where: { semana_id: semanaId }, orderBy: { id: 'asc' } });
}

export async function listarMovimientos(negocioId: bigint, semanaId: bigint) {
  await getSemanaAbierta(negocioId, semanaId);
  const movs = await movimientosDeSemana(semanaId);
  return movs.map((m) => ({
    id: Number(m.id),
    fecha: iso(m.fecha),
    tipo: m.tipo,
    monto: num0(m.monto),
    ubicacion_origen_id: m.ubicacion_origen_id ? Number(m.ubicacion_origen_id) : null,
    ubicacion_destino_id: m.ubicacion_destino_id ? Number(m.ubicacion_destino_id) : null,
    categoria_id: m.categoria_id ? Number(m.categoria_id) : null,
    socio_id: m.socio_id ? Number(m.socio_id) : null,
    facturado: m.facturado,
    descripcion: m.descripcion,
    compra_id: m.compra_id ? Number(m.compra_id) : null,
  }));
}

export interface EditarMovimientoInput {
  monto?: number;
  fecha?: string;
  ubicacion_origen_id?: number | null;
  ubicacion_destino_id?: number | null;
  categoria_id?: number | null;
  descripcion?: string | null;
  facturado?: boolean;
}

/** Edita un movimiento manual de una semana abierta. Los movimientos creados
 * por una compra se corrigen desde el ticket para mantener compra y movimiento
 * sincronizados. */
export async function editarMovimiento(negocioId: bigint, movimientoId: bigint, input: EditarMovimientoInput) {
  return prisma.$transaction(async (tx) => {
    const actual = await tx.movimientos.findFirst({
      where: { id: movimientoId, negocio_id: negocioId },
      include: { semanas: { select: { estado: true, fecha_inicio: true, fecha_fin: true } } },
    });
    if (!actual) throw new HttpError(404, 'Movimiento no encontrado');
    if (actual.tipo === 'comision_terminal') throw new HttpError(400, 'La comisión de terminal se recalcula al cerrar');
    if (actual.compra_id != null) throw new HttpError(409, 'Este gasto pertenece a una compra; corrígelo desde el ticket');
    if (actual.semanas.estado !== 'abierta') throw new HttpError(409, 'La semana está cerrada; reábrela antes de editar');

    const fecha = input.fecha ? new Date(`${input.fecha}T00:00:00Z`) : actual.fecha;
    if (Number.isNaN(fecha.getTime()) || iso(fecha) < iso(actual.semanas.fecha_inicio) || iso(fecha) > iso(actual.semanas.fecha_fin)) {
      throw new HttpError(400, 'La fecha está fuera de la semana');
    }
    const monto = input.monto ?? num0(actual.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new HttpError(400, 'El monto debe ser mayor a cero');

    const origenId = input.ubicacion_origen_id === undefined
      ? actual.ubicacion_origen_id
      : input.ubicacion_origen_id == null ? null : BigInt(input.ubicacion_origen_id);
    const destinoId = input.ubicacion_destino_id === undefined
      ? actual.ubicacion_destino_id
      : input.ubicacion_destino_id == null ? null : BigInt(input.ubicacion_destino_id);
    const idsUbicacion = [origenId, destinoId].filter((v): v is bigint => v != null);
    const ubicaciones = await tx.ubicaciones_fondos.findMany({ where: { id: { in: idsUbicacion }, negocio_id: negocioId, activo: true }, select: { id: true, tipo: true } });
    if (ubicaciones.length !== idsUbicacion.length) throw new HttpError(400, 'La ubicación de origen o destino no es válida');
    const origen = ubicaciones.find((u) => u.id === origenId);

    const categoriaId = input.categoria_id === undefined
      ? actual.categoria_id
      : input.categoria_id == null ? null : BigInt(input.categoria_id);
    const regla = REGLAS_MOVIMIENTO[actual.tipo];
    if (regla.requiereOrigen && !origenId) throw new HttpError(400, `${actual.tipo} requiere ubicación de origen`);
    if (regla.requiereDestino && !destinoId) throw new HttpError(400, `${actual.tipo} requiere ubicación de destino`);
    if (regla.requiereCategoria && !categoriaId) throw new HttpError(400, `${actual.tipo} requiere categoría`);
    if (categoriaId) {
      const categoria = await tx.categorias_gasto.findFirst({ where: { id: categoriaId, negocio_id: negocioId, activo: true }, select: { id: true } });
      if (!categoria) throw new HttpError(400, 'La categoría no es válida');
    }

    const facturado = input.facturado ?? ((actual.tipo === 'gasto' || actual.tipo === 'compra_inventario') && origen?.tipo === 'banco');
    const actualizado = await tx.movimientos.update({
      where: { id: actual.id },
      data: {
        monto, fecha, ubicacion_origen_id: origenId, ubicacion_destino_id: destinoId, categoria_id: categoriaId,
        facturado, descripcion: input.descripcion === undefined ? actual.descripcion : input.descripcion?.trim() || null,
      },
    });
    return { id: Number(actualizado.id), monto: num0(actualizado.monto), fecha: iso(actualizado.fecha), facturado: actualizado.facturado };
  });
}

// ---------------------------------------------------------------------------
//  Captura diaria (ventas/propinas por día) — editable por día
// ---------------------------------------------------------------------------
function diasDeSemana(inicio: Date, fin: Date): string[] {
  const dias: string[] = [];
  for (let d = new Date(inicio); d <= fin; d = masDias(d, 1)) dias.push(iso(d));
  return dias;
}

const DIA_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Marcadores para distinguir lo capturado en "Por día" de lo itemizado en "Otros mov.".
const MARCA_VENTA = 'Venta del día';
const MARCA_GASTO = 'Gasto del día';
const MARCA_SUELDO = 'Sueldo del día';
const MARCAS_DIA = [MARCA_VENTA, MARCA_GASTO, MARCA_SUELDO];

/** Ubicaciones por defecto para ventas: Caja (efectivo sin socio) y Banco. */
async function ubicacionesVenta(negocioId: bigint) {
  const ubic = await prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { id: 'asc' } });
  const caja = ubic.find((u) => u.tipo === 'efectivo' && u.socio_id == null) ?? ubic.find((u) => u.tipo === 'efectivo');
  const banco = ubic.find((u) => u.tipo === 'banco');
  if (!caja || !banco) throw new HttpError(400, 'Faltan ubicaciones Caja/Banco configuradas');
  return { caja, banco };
}

/** Resumen por día: ventas (efectivo/tarjeta/propina) y egresos del día (gastos/sueldos). */
export async function resumenDiario(negocioId: bigint, semanaId: bigint) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const movs = await movimientosDeSemana(semanaId);
  const dias = diasDeSemana(semana.fecha_inicio, semana.fecha_fin);
  const filas = dias.map((fecha) => {
    const delDia = movs.filter((m) => iso(m.fecha) === fecha);
    const suma = (tipo: TipoMovimiento, marca?: string) =>
      redondear(delDia.filter((m) => m.tipo === tipo && (!marca || m.descripcion === marca)).reduce((a, m) => a + num0(m.monto), 0));
    const venta_efectivo = suma('venta_efectivo');
    const venta_tarjeta = suma('venta_tarjeta');
    const propina_tarjeta = suma('propina_tarjeta');
    // Solo lo capturado como "del día" es editable aquí (lo itemizado vive en Otros mov.).
    const gasto_efectivo = suma('gasto', MARCA_GASTO);
    const gasto_itemizado = redondear(delDia.filter((m) => m.tipo === 'gasto' && m.compra_id != null).reduce((a, m) => a + num0(m.monto), 0));
    const compra_inventario = suma('compra_inventario');
    const sueldos = suma('sueldo', MARCA_SUELDO);
    const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
    return {
      fecha,
      dia: DIA_SEMANA[dow]!,
      venta_efectivo, venta_tarjeta, propina_tarjeta, gasto_efectivo, gasto_itemizado, compra_inventario, sueldos,
      total_ventas: redondear(venta_efectivo + venta_tarjeta + propina_tarjeta),
      total_egresos: redondear(gasto_efectivo + gasto_itemizado + compra_inventario + sueldos),
    };
  });
  return { semana_id: Number(semanaId), estado: semana.estado, dias: filas };
}

export interface DiaInput {
  venta_efectivo: number;
  venta_tarjeta: number;
  propina_tarjeta: number;
  gasto_efectivo: number;
  sueldos: number;
}

/**
 * Captura/edita UN día completo. Reemplaza solo los movimientos "del día"
 * (marcados por descripción): ventas, gasto en efectivo y sueldos. Los gastos
 * itemizados de Otros mov. no se tocan.
 */
export async function registrarDia(negocioId: bigint, usuarioId: bigint, semanaId: bigint, fecha: string, datos: DiaInput) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  if (semana.estado !== 'abierta') throw new HttpError(409, 'La semana está cerrada');
  if (fecha < iso(semana.fecha_inicio) || fecha > iso(semana.fecha_fin)) {
    throw new HttpError(400, 'La fecha está fuera de la semana');
  }
  const { caja, banco } = await ubicacionesVenta(negocioId);
  const otros = await prisma.categorias_gasto.findFirst({ where: { negocio_id: negocioId, nombre: 'Otros' } });
  const fechaDate = new Date(fecha + 'T00:00:00Z');

  await prisma.$transaction(async (tx) => {
    // Borra solo lo capturado como "del día" en esa fecha.
    await tx.movimientos.deleteMany({
      where: { semana_id: semanaId, fecha: fechaDate, descripcion: { in: MARCAS_DIA } },
    });

    type Nuevo = { tipo: TipoMovimiento; monto: number; origen?: bigint; destino?: bigint; categoria?: bigint | null; marca: string };
    const nuevos: Nuevo[] = [];
    if (datos.venta_efectivo > 0) nuevos.push({ tipo: 'venta_efectivo', monto: datos.venta_efectivo, destino: caja.id, marca: MARCA_VENTA });
    if (datos.venta_tarjeta > 0) nuevos.push({ tipo: 'venta_tarjeta', monto: datos.venta_tarjeta, destino: banco.id, marca: MARCA_VENTA });
    if (datos.propina_tarjeta > 0) nuevos.push({ tipo: 'propina_tarjeta', monto: datos.propina_tarjeta, destino: banco.id, marca: MARCA_VENTA });
    if (datos.gasto_efectivo > 0) nuevos.push({ tipo: 'gasto', monto: datos.gasto_efectivo, origen: caja.id, categoria: otros?.id ?? null, marca: MARCA_GASTO });
    if (datos.sueldos > 0) nuevos.push({ tipo: 'sueldo', monto: datos.sueldos, origen: caja.id, marca: MARCA_SUELDO });

    for (const n of nuevos) {
      await tx.movimientos.create({
        data: {
          negocio_id: negocioId, semana_id: semanaId, fecha: fechaDate, tipo: n.tipo, monto: n.monto,
          ubicacion_origen_id: n.origen ?? null, ubicacion_destino_id: n.destino ?? null,
          categoria_id: n.categoria ?? null, usuario_id: usuarioId, descripcion: n.marca,
        },
      });
    }
  });
  return resumenDiario(negocioId, semanaId);
}

// ---------------------------------------------------------------------------
//  Saldos teóricos / Cuadre
// ---------------------------------------------------------------------------
function aMovBalance(m: { ubicacion_origen_id: bigint | null; ubicacion_destino_id: bigint | null; monto: unknown }): MovBalance {
  return {
    ubicacion_origen_id: m.ubicacion_origen_id ? Number(m.ubicacion_origen_id) : null,
    ubicacion_destino_id: m.ubicacion_destino_id ? Number(m.ubicacion_destino_id) : null,
    monto: num0(m.monto as never),
  };
}

export async function cuadre(negocioId: bigint, semanaId: bigint) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const [ubicaciones, movs, inicialMap] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { id: 'asc' } }),
    movimientosDeSemana(semanaId),
    mapaSaldoInicial(negocioId, semana.fecha_inicio),
  ]);
  const teoricos = calcularSaldosTeoricos(inicialMap, movs.map(aMovBalance));

  // Último arqueo por ubicación dentro de la semana.
  const arqueos = await prisma.arqueos.findMany({ where: { semana_id: semanaId }, orderBy: { id: 'desc' } });
  const realPorUbic = new Map<number, number>();
  for (const a of arqueos) {
    const k = Number(a.ubicacion_id);
    if (!realPorUbic.has(k)) realPorUbic.set(k, num0(a.monto_real)); // el más reciente
  }

  const filas = ubicaciones.map((u) => {
    const id = Number(u.id);
    const saldo_inicial = inicialMap[id] ?? 0;
    const saldo_teorico = teoricos[id] ?? saldo_inicial;
    const real = realPorUbic.has(id) ? realPorUbic.get(id)! : null;
    return {
      ubicacion_id: id,
      nombre: u.nombre,
      tipo: u.tipo,
      saldo_inicial,
      saldo_teorico,
      saldo_real: real,
      descuadre: real != null ? descuadre(real, saldo_teorico) : null,
    };
  });
  return { semana_id: Number(semanaId), ubicaciones: filas };
}

export async function crearArqueo(negocioId: bigint, usuarioId: bigint, semanaId: bigint, ubicacionId: number, montoReal: number, fecha?: string) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const ubic = await prisma.ubicaciones_fondos.findFirst({ where: { id: BigInt(ubicacionId), negocio_id: negocioId } });
  if (!ubic) throw new HttpError(400, 'Ubicación inválida');
  const a = await prisma.arqueos.create({
    data: {
      negocio_id: negocioId,
      semana_id: semana.id,
      ubicacion_id: BigInt(ubicacionId),
      monto_real: montoReal,
      usuario_id: usuarioId,
      fecha: fecha ? new Date(fecha + 'T00:00:00Z') : new Date(),
    },
  });
  return { id: Number(a.id) };
}

// ---------------------------------------------------------------------------
//  Resumen semanal
// ---------------------------------------------------------------------------
function sumarPorTipo(movs: { tipo: TipoMovimiento; monto: unknown }[], tipo: TipoMovimiento): number {
  return redondear(movs.filter((m) => m.tipo === tipo).reduce((a, m) => a + num0(m.monto as never), 0));
}

export async function resumen(negocioId: bigint, semanaId: bigint) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const [ubicaciones, movs, inicialMap, socios] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true } }),
    movimientosDeSemana(semanaId),
    mapaSaldoInicial(negocioId, semana.fecha_inicio),
    prisma.socios.findMany({ where: { negocio_id: negocioId, activo: true } }),
  ]);

  const ventaEfectivo = sumarPorTipo(movs, 'venta_efectivo');
  const ventaTarjeta = sumarPorTipo(movs, 'venta_tarjeta');
  const propinaTarjeta = sumarPorTipo(movs, 'propina_tarjeta');
  const comprasInventario = sumarPorTipo(movs, 'compra_inventario');
  const gastosFacturados = redondear(movs.filter((m) => m.facturado).reduce((a, m) => a + num0(m.monto as never), 0));

  // Saldo real final: arqueo si hay, si no teórico (igual que en el cierre).
  const teoricos = calcularSaldosTeoricos(inicialMap, movs.map(aMovBalance));
  const arqueos = await prisma.arqueos.findMany({ where: { semana_id: semanaId }, orderBy: { id: 'desc' } });
  const realPorUbic = new Map<number, number>();
  for (const a of arqueos) { const k = Number(a.ubicacion_id); if (!realPorUbic.has(k)) realPorUbic.set(k, num0(a.monto_real)); }

  let saldoInicialTotal = 0;
  let saldoRealFinalTotal = 0;
  for (const u of ubicaciones) {
    const id = Number(u.id);
    saldoInicialTotal += inicialMap[id] ?? 0;
    saldoRealFinalTotal += realPorUbic.has(id) ? realPorUbic.get(id)! : (teoricos[id] ?? inicialMap[id] ?? 0);
  }

  const r = resumenSemana({
    saldoInicialTotal: redondear(saldoInicialTotal),
    saldoRealFinalTotal: redondear(saldoRealFinalTotal),
    ventaEfectivo,
    ventaTarjeta,
    propinaTarjeta,
    comprasInventario,
    gastosFacturados,
  });
  const inventario = await inventarioDeSemana(negocioId, semanaId);
  const conciliacion_inventario = await conciliacionInventarioSemana(negocioId, semanaId);

  // Capital por socio.
  const ubicSocio = new Map<number, number>(); // ubicacion_id -> socio_id
  for (const u of ubicaciones) if (u.socio_id) ubicSocio.set(Number(u.id), Number(u.socio_id));
  const capital = socios.map((s) => {
    const sid = Number(s.id);
    const transferencias = redondear(
      movs.filter((m) => m.tipo === 'transferencia' && m.ubicacion_destino_id != null && ubicSocio.get(Number(m.ubicacion_destino_id)) === sid)
        .reduce((a, m) => a + num0(m.monto as never), 0),
    );
    const retiros = redondear(
      movs.filter((m) => m.tipo === 'retiro_socio' && Number(m.socio_id) === sid).reduce((a, m) => a + num0(m.monto as never), 0),
    );
    return { socio_id: sid, nombre: s.nombre, transferencias, retiros, capital: capitalSocio(transferencias, retiros) };
  });

  return {
    semana_id: Number(semanaId),
    estado: semana.estado,
    ventas: { efectivo: ventaEfectivo, tarjeta: ventaTarjeta, propinas: propinaTarjeta, total: r.ventasTotales },
    comision_terminal_estimada: comisionTerminal(ventaTarjeta, propinaTarjeta),
    compras_inventario: comprasInventario,
    inventario,
    conciliacion_inventario,
    utilidad: r.utilidad,
    margen: r.margen,
    utilidad_pct: r.utilidadPct,
    facturado: { tarjeta_facturable: r.tarjetaFacturable, gastos_facturados: r.gastosFacturados, balance: r.balanceFacturado },
    capital_socios: capital,
    saldo_inicial_total: redondear(saldoInicialTotal),
    saldo_real_final_total: redondear(saldoRealFinalTotal),
  };
}

// ---------------------------------------------------------------------------
//  Cierre de semana
// ---------------------------------------------------------------------------
export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, semanaId: bigint, confirmarExcepciones = false) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  // El cierre no debe ocultar ventas que no pudieron convertirse en consumo
  // FIFO. Permitimos continuar únicamente después de una confirmación explícita
  // para que la excepción quede visible y no se interprete como margen real.
  const finExclusivo = new Date(semana.fecha_fin);
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  const excepcionesCosteo = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: negocioId,
      fecha: { gte: semana.fecha_inicio, lt: finExclusivo },
      costeo_estado: 'excepcion',
    },
    select: { id: true, producto_nombre: true, cantidad: true, costeo_error: true },
    orderBy: { fecha: 'asc' },
    take: 100,
  });
  if (excepcionesCosteo.length && !confirmarExcepciones) {
    throw new HttpError(409, `Hay ${excepcionesCosteo.length} excepciones de costeo pendientes antes de cerrar la semana`, {
      tipo: 'excepciones_costeo',
      total: excepcionesCosteo.length,
      ventas: excepcionesCosteo.map((fila) => ({ id: Number(fila.id), producto: fila.producto_nombre, cantidad: Number(fila.cantidad), error: fila.costeo_error })),
      instruccion: 'Revisa el mapeo y las recetas; si aceptas cerrar, confirma explícitamente las excepciones.',
    });
  }

  // La semana debe tener una apertura congelada antes de registrar su cierre.
  await asegurarInventarioSemanal(negocioId, semanaId);

  const [ubicaciones, banco, invActual, fifoCorte] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true } }),
    prisma.ubicaciones_fondos.findFirst({ where: { negocio_id: negocioId, tipo: 'banco' }, orderBy: { id: 'asc' } }),
    inventarioActual(negocioId), // lectura pesada: se hace ANTES de abrir la transacción
    valorFifoAlCorte(negocioId, semana.fecha_fin),
  ]);
  // El cierre contable usa el valor del ledger FIFO en vivo. Si todavía no
  // hay lotes (por ejemplo, durante el bootstrap inicial), conserva el valor
  // del conteo físico para no ocultar inventario sin libro.
  const valorInventario = fifoCorte.lotes > 0 ? fifoCorte.valor : invActual.valor_total;

  await prisma.$transaction(async (tx) => {
    const movs = await tx.movimientos.findMany({ where: { semana_id: semanaId } });

    // El último conteo vigente se consolida en un snapshot inmutable de cierre.
    // Así, el próximo periodo abrirá exactamente con este inventario y no con
    // el siguiente conteo global que se capture en otra zona.
    const cierreSnapshot = await crearSnapshotConsolidado(tx, negocioId, invActual);
    await tx.inventario_semanal.update({
      where: { semana_id: semanaId },
      data: { cierre_snapshot_id: cierreSnapshot.id, cierre_valor: valorInventario },
    });

    // 1) Comisión de terminal automática (origen Banco), si hay ingreso por tarjeta y no existe ya.
    const ventaTarjeta = sumarPorTipo(movs, 'venta_tarjeta');
    const propinaTarjeta = sumarPorTipo(movs, 'propina_tarjeta');
    const comision = comisionTerminal(ventaTarjeta, propinaTarjeta);
    const yaHayComision = movs.some((m) => m.tipo === 'comision_terminal');
    if (comision > 0 && !yaHayComision && banco) {
      await tx.movimientos.create({
        data: {
          negocio_id: negocioId, semana_id: semanaId, fecha: semana.fecha_fin,
          tipo: 'comision_terminal', monto: comision, ubicacion_origen_id: banco.id,
          descripcion: 'Comisión terminal 1.99% (automática)', usuario_id: usuarioId,
        },
      });
    }

    // 2) Saldos finales por ubicación (con la comisión ya incluida).
    const movsFinal = await tx.movimientos.findMany({ where: { semana_id: semanaId } });
    const inicialMap = await mapaSaldoInicial(negocioId, semana.fecha_inicio);
    const teoricos = calcularSaldosTeoricos(inicialMap, movsFinal.map(aMovBalance));
    const arqueos = await tx.arqueos.findMany({ where: { semana_id: semanaId }, orderBy: { id: 'desc' } });
    const realPorUbic = new Map<number, number>();
    for (const a of arqueos) { const k = Number(a.ubicacion_id); if (!realPorUbic.has(k)) realPorUbic.set(k, num0(a.monto_real)); }

    let totalBanco = 0;
    let totalEfectivo = 0;
    for (const u of ubicaciones) {
      const id = Number(u.id);
      const saldo_inicial = inicialMap[id] ?? 0;
      const saldo_teorico = teoricos[id] ?? saldo_inicial;
      const saldo_real = realPorUbic.has(id) ? realPorUbic.get(id)! : null;
      const saldo_final = saldo_real ?? saldo_teorico;
      await tx.cierres_semana.create({
        data: { semana_id: semanaId, ubicacion_id: u.id, saldo_inicial, saldo_teorico, saldo_real, saldo_final },
      });
      if (u.tipo === 'banco') totalBanco += saldo_final;
      else totalEfectivo += saldo_final;
    }

    await tx.semanas.update({ where: { id: semanaId }, data: { estado: 'cerrada', cerrada_at: new Date() } });

    // Fase 4: snapshot de patrimonio (banco + efectivo + inventario − pasivos).
    await generarSnapshotEnCierre(tx, negocioId, semana.fecha_fin, redondear(totalBanco), redondear(totalEfectivo), valorInventario);
  }, {
    // La DB remota (Render) tiene latencia y el cierre hace varias queries + lee el
    // inventario para el snapshot; el default de 5s se queda corto. Damos margen.
    timeout: 20000,
    maxWait: 15000,
  });

  return resumen(negocioId, semanaId);
}

/**
 * Reabre una semana cerrada para poder editarla de nuevo. Deshace TODO lo que hizo el
 * cierre: borra los cierres congelados, la comisión de terminal automática y el snapshot
 * de patrimonio de esa semana. Solo se permite reabrir la última semana cerrada, para no
 * dejar inconsistente el encadenado de semanas posteriores (que congelaron su saldo inicial
 * a partir de ésta).
 */
export async function reabrirSemana(negocioId: bigint, semanaId: bigint) {
  const semana = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  if (semana.estado !== 'cerrada') throw new HttpError(409, 'La semana no está cerrada');

  const posterior = await prisma.semanas.findFirst({
    where: { negocio_id: negocioId, estado: 'cerrada', fecha_inicio: { gt: semana.fecha_inicio } },
  });
  if (posterior) {
    throw new HttpError(409, 'Solo puedes reabrir la semana cerrada más reciente. Reabre primero las posteriores.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.cierres_semana.deleteMany({ where: { semana_id: semanaId } });
    // La comisión de terminal solo se crea automáticamente al cerrar: se puede borrar sin riesgo.
    await tx.movimientos.deleteMany({ where: { semana_id: semanaId, tipo: 'comision_terminal' } });
    // El snapshot de patrimonio del cierre está identificado por (negocio, fecha_fin).
    await tx.snapshots_patrimonio.deleteMany({ where: { negocio_id: negocioId, fecha: semana.fecha_fin } });
    await tx.inventario_semanal.updateMany({
      where: { semana_id: semanaId },
      data: { cierre_snapshot_id: null, cierre_valor: null },
    });
    await tx.semanas.update({ where: { id: semanaId }, data: { estado: 'abierta', cerrada_at: null } });
  });

  return serializarSemana((await prisma.semanas.findUniqueOrThrow({ where: { id: semanaId } })));
}

// ---------------------------------------------------------------------------
//  Configuración (admin): ubicaciones de fondos, categorías, socios, saldos
// ---------------------------------------------------------------------------

/** Config completa para la pantalla de ajustes: incluye inactivos para poder reactivar. */
export async function adminConfig(negocioId: bigint) {
  const [ubic, cats, socs, saldos] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId }, orderBy: { id: 'asc' } }),
    prisma.categorias_gasto.findMany({ where: { negocio_id: negocioId }, orderBy: { nombre: 'asc' } }),
    prisma.socios.findMany({ where: { negocio_id: negocioId }, orderBy: { nombre: 'asc' } }),
    prisma.saldos_iniciales.findMany({ where: { negocio_id: negocioId } }),
  ]);
  return {
    ubicaciones: ubic.map((u) => ({ id: Number(u.id), nombre: u.nombre, tipo: u.tipo, socio_id: u.socio_id ? Number(u.socio_id) : null, activo: u.activo })),
    categorias: cats.map((c) => ({ id: Number(c.id), nombre: c.nombre, activo: c.activo })),
    socios: socs.map((s) => ({ id: Number(s.id), nombre: s.nombre, activo: s.activo })),
    saldos_iniciales: saldos.map((f) => ({ ubicacion_id: Number(f.ubicacion_id), monto: num0(f.monto) })),
  };
}

/**
 * Corrige los saldos iniciales (bootstrap) por ubicación. A diferencia de fijarSaldosIniciales
 * (una sola vez), esto permite al admin ajustar el saldo base. Solo afecta el cálculo de
 * semanas que derivan del bootstrap; las semanas ya cerradas guardan su cierre congelado.
 */
export async function editarSaldosIniciales(negocioId: bigint, saldos: { ubicacion_id: number; monto: number }[]) {
  const ubic = await prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId }, select: { id: true } });
  const validas = new Set(ubic.map((u) => u.id.toString()));
  for (const s of saldos) {
    if (!validas.has(s.ubicacion_id.toString())) throw new HttpError(400, `Ubicación ${s.ubicacion_id} inválida`);
  }
  await prisma.$transaction(
    saldos.map((s) =>
      prisma.saldos_iniciales.upsert({
        where: { ubicacion_id: BigInt(s.ubicacion_id) },
        update: { monto: s.monto },
        create: { negocio_id: negocioId, ubicacion_id: BigInt(s.ubicacion_id), monto: s.monto },
      }),
    ),
  );
  return getSaldosIniciales(negocioId);
}

// --- Ubicaciones de fondos ---
export async function crearUbicacion(negocioId: bigint, data: { nombre: string; tipo: 'banco' | 'efectivo'; socio_id?: number | null }) {
  const u = await prisma.ubicaciones_fondos.create({
    data: { negocio_id: negocioId, nombre: data.nombre, tipo: data.tipo, socio_id: data.socio_id != null ? BigInt(data.socio_id) : null },
  });
  return { id: Number(u.id) };
}

export async function editarUbicacion(negocioId: bigint, id: bigint, data: { nombre?: string; tipo?: 'banco' | 'efectivo'; socio_id?: number | null; activo?: boolean }) {
  const existe = await prisma.ubicaciones_fondos.findFirst({ where: { id, negocio_id: negocioId } });
  if (!existe) throw new HttpError(404, 'Ubicación no encontrada');
  await prisma.ubicaciones_fondos.update({
    where: { id },
    data: {
      nombre: data.nombre,
      tipo: data.tipo,
      socio_id: data.socio_id === undefined ? undefined : data.socio_id != null ? BigInt(data.socio_id) : null,
      activo: data.activo,
    },
  });
  return { ok: true };
}

// --- Categorías de gasto ---
export async function crearCategoria(negocioId: bigint, nombre: string) {
  const c = await prisma.categorias_gasto.create({ data: { negocio_id: negocioId, nombre } });
  return { id: Number(c.id) };
}

export async function editarCategoria(negocioId: bigint, id: bigint, data: { nombre?: string; activo?: boolean }) {
  const existe = await prisma.categorias_gasto.findFirst({ where: { id, negocio_id: negocioId } });
  if (!existe) throw new HttpError(404, 'Categoría no encontrada');
  await prisma.categorias_gasto.update({ where: { id }, data: { nombre: data.nombre, activo: data.activo } });
  return { ok: true };
}

// --- Socios ---
export async function crearSocio(negocioId: bigint, nombre: string) {
  const s = await prisma.socios.create({ data: { negocio_id: negocioId, nombre } });
  return { id: Number(s.id) };
}

export async function editarSocio(negocioId: bigint, id: bigint, data: { nombre?: string; activo?: boolean }) {
  const existe = await prisma.socios.findFirst({ where: { id, negocio_id: negocioId } });
  if (!existe) throw new HttpError(404, 'Socio no encontrado');
  await prisma.socios.update({ where: { id }, data: { nombre: data.nombre, activo: data.activo } });
  return { ok: true };
}

/** Borra un movimiento. Solo en semana abierta (las cerradas tienen saldos congelados). */
export async function borrarMovimiento(negocioId: bigint, id: bigint) {
  const mov = await prisma.movimientos.findFirst({ where: { id, negocio_id: negocioId } });
  if (!mov) throw new HttpError(404, 'Movimiento no encontrado');
  const semana = await prisma.semanas.findUnique({ where: { id: mov.semana_id } });
  if (!semana || semana.estado !== 'abierta') {
    throw new HttpError(409, 'No se pueden borrar movimientos de una semana cerrada');
  }
  if (mov.compra_id != null) throw new HttpError(409, 'Este movimiento pertenece a una compra; edita o elimina el ticket completo');
  await prisma.movimientos.delete({ where: { id } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  Estado de resultados (P&L) por mes
// ---------------------------------------------------------------------------

/** Mapa mes -> valor del inventario al abrir y al cerrar, tomado de los snapshots de cierre. */
function inventarioPorMes(
  meses: string[],
  snapshots: { fecha: Date; total_inventario: unknown }[],
): Record<string, InventarioMes> {
  const serie = snapshots
    .map((s) => ({ fecha: iso(s.fecha), valor: num0(s.total_inventario as never) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const out: Record<string, InventarioMes> = {};
  for (const mes of meses) {
    // Inicial: el último cierre ANTES de que empiece el mes. Final: el último DENTRO del mes.
    const previos = serie.filter((s) => s.fecha < `${mes}-01`);
    const dentro = serie.filter((s) => s.fecha.slice(0, 7) === mes);
    const ini = previos.length ? previos[previos.length - 1]! : null;
    const fin = dentro.length ? dentro[dentro.length - 1]! : null;
    out[mes] = {
      inicial: ini ? ini.valor : null,
      final: fin ? fin.valor : null,
      fecha_inicial: ini ? ini.fecha : null,
      fecha_final: fin ? fin.fecha : null,
    };
  }
  return out;
}

/**
 * Estado de resultados de los últimos `meses` meses calendario (el mes en curso
 * incluido y marcado como parcial). Agrupa por fecha del movimiento, no por
 * semana, porque las semanas cruzan meses.
 */
export async function estadoResultados(negocioId: bigint, meses = 6) {
  const n = Math.min(Math.max(Math.trunc(meses) || 6, 1), 36);
  const listaMeses = mesesRecientes(new Date(), n);
  const desde = new Date(`${listaMeses[0]}-01T00:00:00.000Z`);
  const ultimo = listaMeses[listaMeses.length - 1]!;
  // Día 0 del mes siguiente = último día del mes pedido.
  const hasta = new Date(Date.UTC(Number(ultimo.slice(0, 4)), Number(ultimo.slice(5, 7)), 0));

  const [movs, snapshots] = await Promise.all([
    prisma.movimientos.findMany({
      where: { negocio_id: negocioId, fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, tipo: true, monto: true, facturado: true, categorias_gasto: { select: { nombre: true } } },
      orderBy: { fecha: 'asc' },
    }),
    prisma.snapshots_patrimonio.findMany({
      where: { negocio_id: negocioId },
      select: { fecha: true, total_inventario: true },
    }),
  ]);

  const filas = estadoResultadosMensual(
    listaMeses,
    movs.map((m) => ({
      fecha: iso(m.fecha),
      tipo: m.tipo,
      monto: num0(m.monto),
      categoria: m.categorias_gasto?.nombre ?? null,
      facturado: m.facturado,
    })),
    inventarioPorMes(listaMeses, snapshots),
  );

  const mesEnCurso = iso(new Date()).slice(0, 7);
  return {
    desde: iso(desde),
    hasta: iso(hasta),
    mes_en_curso: mesEnCurso,
    meses: filas.map((f) => ({ ...f, parcial: f.mes === mesEnCurso })),
    total: totalizarPnl(filas),
  };
}
