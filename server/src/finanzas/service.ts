import { Prisma, type TipoMovimiento } from '@prisma/client';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import {
  comisionTerminal,
  calcularSaldosTeoricos,
  descuadre,
  resumenSemana,
  capitalSocio,
  redondear,
  REGLAS_MOVIMIENTO,
  mesesRecientes,
  estadoResultadosMensual,
  totalizarPnl,
  seleccionarValorPatrimonio,
  type MovBalance,
  type InventarioMes,
} from './logic.js';
import { generarSnapshotEnCierre, sumaPasivosActivos } from '../patrimonio/service.js';
import { inventarioActual, valorSnapshot } from '../inventario/service.js';
import { valorFifoAlCorte } from '../inventario/consumo-epos.js';
import { esConsumoFifoActivo, esReversionFifo, filtroConsumoFifoActivo } from '../inventario/fuentes.js';

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

// Epos entrega timestamps reales en UTC, mientras que las semanas y los
// cortes de Ibérico se capturan como fechas locales de México (UTC-06:00).
// Una semana local lunes-domingo termina a las 06:00Z del lunes siguiente.
function rangoEposSemana(fechaInicio: Date, fechaFin: Date): { inicio: Date; fin: Date } {
  const inicio = new Date(`${iso(fechaInicio)}T06:00:00.000Z`);
  const fin = new Date(`${iso(fechaFin)}T06:00:00.000Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { inicio, fin };
}

/**
 * Las reversiones son eventos inmutables del historial. No representan
 * consumo corriente: cancelan un movimiento previo al reconstruir el saldo
 * del lote, pero nunca deben volver a entrar al costo de ventas ni a la
 * conciliación del período.
 */
type IncidenciaTipo = 'conversion' | 'compra_faltante' | 'receta' | 'captura' | 'posible_merma' | 'sin_diferencia';

function unidadComparable(unidad: string | null): string | null {
  if (!unidad) return null;
  // Las cervezas pueden guardar la presentación en el nombre ("pieza 355
  // ml"), pero siguen siendo una pieza para efectos del inventario.
  return unidad.trim().toLowerCase().replace(/\s+\d+(?:[.,]\d+)?\s*ml$/, '').trim();
}

function clasificarIncidencia(args: {
  diferencia: number;
  diferenciaConsumo: number;
  diferenciaApertura: number;
  diferenciaConversion: number;
  inicial: number;
  compras: number;
  unidadBase: string | null;
  unidadCompra: string | null;
  contenidoCompra: number | null;
  factoresApertura: number[];
  factoresCierre: number[];
  tieneAperturaFifo: boolean;
}): { tipo: IncidenciaTipo; texto: string } {
  if (Math.abs(args.diferenciaConversion) > 0.01) {
    return { tipo: 'conversion', texto: 'Revisar conversión de presentación entre apertura y cierre' };
  }
  if (Math.abs(args.diferenciaApertura) > 0.01) {
    return { tipo: 'captura', texto: 'Diferencia histórica: apertura física no coincide con FIFO de apertura' };
  }
  if (!args.tieneAperturaFifo && args.inicial > 0) return { tipo: 'captura', texto: 'Captura: apertura FIFO pendiente de validar' };
  if (Math.abs(args.diferencia) <= 0.01 && Math.abs(args.diferenciaConsumo) <= 0.01) return { tipo: 'sin_diferencia', texto: 'Sin incidencia' };
  // Sólo llamamos "conversión" cuando la diferencia observada es compatible
  // con una o varias presentaciones completas. Una unidad distinta por sí
  // sola (por ejemplo botella→ml) no explica una merma parcial y debe seguir
  // pasando por las categorías de compra, receta, captura o merma.
  const unidadCompra = unidadComparable(args.unidadCompra);
  const unidadBase = unidadComparable(args.unidadBase);
  const contenido = args.contenidoCompra && args.contenidoCompra > 0 ? args.contenidoCompra : null;
  const presentaciones = contenido ? Math.abs(args.diferencia) / contenido : 0;
  const presentacionesCompletas = contenido != null && presentaciones >= 0.5 && Math.abs(presentaciones - Math.round(presentaciones)) <= 0.03;
  // La diferencia de nombres de unidad (por ejemplo, botella → ml) no prueba
  // una conversión: ambos snapshots pueden haber usado el mismo factor. Sólo
  // elevamos a conversión cuando el factor capturado cambió entre apertura y
  // cierre y la diferencia equivale a presentaciones completas.
  const factoresApertura = new Set(args.factoresApertura.map((factor) => Math.round(factor * 1_000_000) / 1_000_000));
  const factoresCierre = new Set(args.factoresCierre.map((factor) => Math.round(factor * 1_000_000) / 1_000_000));
  const factoresCambian = factoresApertura.size !== factoresCierre.size || [...factoresApertura].some((factor) => !factoresCierre.has(factor));
  if (unidadCompra && unidadBase && unidadCompra !== unidadBase && factoresCambian && presentacionesCompletas) {
    return {
      tipo: 'conversion',
      texto: `Revisar conversión de presentación (${args.unidadCompra} → ${args.unidadBase}; factor ${contenido})`,
    };
  }
  if (args.diferencia > 0.01 && args.compras <= 0.01) return { tipo: 'compra_faltante', texto: 'Posible compra faltante o no registrada' };
  if (args.diferenciaConsumo > 0.01) return { tipo: 'posible_merma', texto: 'Posible merma o consumo no registrado' };
  if (args.diferenciaConsumo < -0.01) return { tipo: 'receta', texto: 'Posible receta o consumo teórico incorrecto' };
  return { tipo: 'captura', texto: 'Posible error de captura o conteo' };
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
  await prisma.semanas.updateMany({
    where: { id: s.id, negocio_id: negocioId },
    data: { etiqueta: etiquetaCanonica(inicio, fin) },
  });
  const actualizado = await prisma.semanas.findFirst({
    where: { id: s.id, negocio_id: negocioId },
  });
  if (!actualizado) throw new HttpError(404, 'Semana no encontrada');
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
  const existente = await prisma.inventario_semanal.findFirst({ where: { semana_id: semanaId, negocio_id: negocioId } });
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
  const semana = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId }, select: { fecha_inicio: true, fecha_fin: true } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  // El ledger guarda el día operativo al mediodía UTC. Este límite incluye el
  // domingo completo y evita que la conciliación quede artificialmente corta.
  const limiteSemanaDb = new Date(`${iso(semana.fecha_fin)}T23:59:59.999Z`);
  const limiteCorte = rangoEposSemana(semana.fecha_inicio, semana.fecha_fin).fin;
  const [movs, fifoCorte, inventarioFisico, consumosPeriodo, consumosActivosDetalle, consumosCostoDetalle, reversionesPeriodo] = await Promise.all([
    prisma.movimientos.findMany({
      where: { negocio_id: negocioId, semana_id: semanaId, tipo: 'compra_inventario' },
      select: { monto: true },
    }),
    // El corte termina el lunes a las 06:00Z para incluir todo el domingo
    // civil. Usar fecha_fin a medianoche excluía ventas y lotes del domingo.
    valorFifoAlCorte(negocioId, limiteCorte),
    // Este snapshot pertenece a la semana consultada. Nunca se usa el último
    // snapshot global, porque eso mezclaría periodos.
    inventarioActual(negocioId, { semanaId, hasta: limiteCorte, vista: 'fisica' }),
    // Sólo movimientos FIFO activos. Las reversiones quedan en el ledger
    // para auditoría, pero no son costo de ventas.
    prisma.inventory_consumptions.aggregate({
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb },
        epos_venta_id: { not: null },
        ...filtroConsumoFifoActivo(),
      },
      _sum: { costo_total: true },
      _count: { _all: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb },
        epos_venta_id: { not: null },
        ...filtroConsumoFifoActivo(),
      },
      select: { epos_venta_id: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb },
        epos_venta_id: { not: null },
        ...filtroConsumoFifoActivo(),
      },
      select: { fuente: true, costo_total: true, epos_venta_id: true },
    }),
    prisma.inventory_consumptions.aggregate({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb }, fuente: { startsWith: 'reversion_' } },
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
  const fisicoActual = inventarioFisico.snapshot_id == null ? null : redondear(inventarioFisico.valor_total);
  // Una semana cerrada conserva su snapshot de cierre como autoridad. Si aún
  // está abierta, el último conteo físico de esa semana es provisional.
  const patrimonioInventario = seleccionarValorPatrimonio(cierreRegistrado, fisicoActual);
  const costoVentasLedger = consumosPeriodo._count._all > 0 ? num0(consumosPeriodo._sum.costo_total) : null;
  // Los lotes normales llevan un sufijo de semana (p. ej. venta_fifo_vivo_w64).
  // Sólo las filas marcadas explícitamente como `_exception` son excepciones.
  // `venta_receta` y `venta_receta_historica` son consumo FIFO normal.
  const esExcepcionCosto = (fuente: string | null) => (fuente ?? '').endsWith('_exception');
  const costoNormal = redondear(consumosCostoDetalle
    .filter((row) => esConsumoFifoActivo({ fuente: row.fuente, cantidad: 1 }) && !esExcepcionCosto(row.fuente))
    .reduce((total, row) => total + num0(row.costo_total), 0));
  const costoExcepcion = redondear(consumosCostoDetalle
    .filter((row) => esExcepcionCosto(row.fuente))
    .reduce((total, row) => total + num0(row.costo_total), 0));
  const filasNormal = consumosCostoDetalle.filter((row) => esConsumoFifoActivo({ fuente: row.fuente, cantidad: 1 }) && !esExcepcionCosto(row.fuente)).length;
  const filasExcepcion = consumosCostoDetalle.filter((row) => esExcepcionCosto(row.fuente)).length;
  const ventasEposException = new Set(consumosCostoDetalle
    .filter((row) => esExcepcionCosto(row.fuente))
    .map((row) => row.epos_venta_id?.toString())
    .filter((id): id is string => Boolean(id)));
  const idsEposActivos = [...new Set(consumosActivosDetalle.map((row) => row.epos_venta_id?.toString()).filter((id): id is string => Boolean(id)))];
  const ventasEposActivas = idsEposActivos.length
    ? await prisma.epos_ventas.aggregate({ where: { negocio_id: negocioId, id: { in: idsEposActivos.map(BigInt) } }, _sum: { costo_fifo: true }, _count: { _all: true } })
    : { _sum: { costo_fifo: null }, _count: { _all: 0 } };
  const costoEposActivas = num0(ventasEposActivas._sum.costo_fifo);
  const diferenciaCostoEpos = costoVentasLedger == null ? null : redondear(costoVentasLedger - costoEposActivas);
  const reporteIndependiente = costoVentasLedger != null && idsEposActivos.length > 0 && Math.abs(diferenciaCostoEpos ?? 0) <= 0.01;
  // El costo de ventas contable procede únicamente del consumo FIFO activo.
  // La variación física (apertura + compras − cierre) se conserva como
  // control de conciliación, pero no puede sustituir un costo que aún no se
  // ha calculado ni fabricar un margen aparente.
  const costoVentas = costoVentasLedger;
  return {
    apertura_snapshot_id: semanal.apertura_snapshot_id == null ? null : Number(semanal.apertura_snapshot_id),
    cierre_snapshot_id: semanal.cierre_snapshot_id == null ? null : Number(semanal.cierre_snapshot_id),
    apertura_valor: apertura,
    compras,
    cierre_valor: cierreRegistrado,
    valor_fisico_actual: fisicoActual,
    valor_patrimonio: patrimonioInventario.valor,
    valor_patrimonio_fuente: patrimonioInventario.fuente,
    costo_ventas: costoVentas,
    costo_ventas_fuente: costoVentasLedger == null ? 'pendiente_fifo' : 'ledger_fifo_en_vivo',
    valor_fifo_corte: fifoCorte.valor,
    unidades_fifo_corte: fifoCorte.unidades,
    diferencia_fifo_vs_fisico: patrimonioInventario.valor == null
      ? null
      : redondear(fifoCorte.valor - patrimonioInventario.valor),
    control_fifo: {
      costo_movimientos_activos: costoVentasLedger,
      costo_normal: costoNormal,
      costo_excepcion: costoExcepcion,
      filas_normal: filasNormal,
      filas_excepcion: filasExcepcion,
      costo_reversiones_historial: num0(reversionesPeriodo._sum.costo_total),
      filas_movimientos_activos: consumosPeriodo._count._all,
      filas_reversiones_historial: reversionesPeriodo._count._all,
      ventas_epos_con_consumo_activo: idsEposActivos.length,
      ventas_epos_con_consumo_exception: ventasEposException.size,
      diferencia_costo_vs_epos: diferenciaCostoEpos,
      reporte_independiente: reporteIndependiente,
      alerta_independencia: reporteIndependiente
        ? null
        : 'El costo de ventas no puede considerarse independiente todavía: faltan movimientos FIFO activos o no coincide con las ventas Epos costeadas.',
    },
    estado: semanal.cierre_snapshot_id == null ? 'pendiente_cierre' : 'cerrado',
    apertura_origen: semanal.apertura_origen,
  };
}

type EstadoConciliacionInventario = 'pendiente_cierre' | 'calculada';

interface FilaConciliacionInventario {
  product_id: number;
  producto: string;
  unidad_base: string | null;
  presentacion_apertura: { zona_id: number; unidad: string; cantidad: number; factor: number }[];
  presentacion_cierre: { zona_id: number; unidad: string; cantidad: number; factor: number }[];
  inventario_inicial: number;
  fifo_apertura: number;
  diferencia_apertura: number;
  diferencia_apertura_valor: number | null;
  compras_recibidas: number;
  ajustes_inventario: number;
  consumo_teorico: number;
  consumo_fifo_activo: number;
  consumo_fisico_inferido: number;
  diferencia_consumo: number;
  diferencia_conversion: number;
  existencia_esperada_movimientos: number;
  diferencia_semana: number;
  existencia_fifo_esperada: number;
  inventario_fisico_final: number;
  diferencia_fifo: number;
  diferencia_fifo_valor: number | null;
  diferencia_cantidad: number;
  costo_fifo: number | null;
  costo_fifo_apertura: number | null;
  diferencia_valor: number | null;
  incidencia_tipo: IncidenciaTipo;
  incidencia: string;
}

/**
 * Compara, producto por producto, el libro FIFO con el último conteo físico
 * de la semana. La cantidad teórica se calcula como apertura + compras −
 * consumo de recetas. La causa de una diferencia es una hipótesis operativa,
 * no una conclusión automática: el usuario debe revisar la evidencia.
 */
export async function conciliacionInventarioSemana(negocioId: bigint, semanaId: bigint) {
  const semanal = await asegurarInventarioSemanal(negocioId, semanaId);
  const filasPersistidas = semanal.cierre_snapshot_id == null
    ? 0
    : await prisma.inventory_fifo_reconciliations.count({ where: { negocio_id: negocioId, semana_id: semanaId } });
  const base = {
    estado: (semanal.cierre_snapshot_id == null ? 'pendiente_cierre' : 'calculada') as EstadoConciliacionInventario,
    apertura_snapshot_id: semanal.apertura_snapshot_id == null ? null : Number(semanal.apertura_snapshot_id),
    cierre_snapshot_id: semanal.cierre_snapshot_id == null ? null : Number(semanal.cierre_snapshot_id),
    filas: [] as FilaConciliacionInventario[],
    total_diferencia_valor: null as number | null,
    productos_con_incidencia: 0,
    consumo_fifo_activo_filas: 0,
    reversiones_historial_filas: 0,
    productos_con_diferencia_consumo: 0,
    diferencia_apertura_valor: null as number | null,
    diferencia_conversion_valor: null as number | null,
    diferencia_semana_valor: null as number | null,
    conciliacion_apertura: null as {
      inventario_fisico: number;
      fifo: number;
      diferencia_historica: number;
      diferencia_conversion: number;
    } | null,
    reporte_independiente: false,
    alerta_independencia: null as string | null,
    persistida: filasPersistidas > 0,
    filas_persistidas: filasPersistidas,
  };
  if (!semanal.apertura_snapshot_id || !semanal.cierre_snapshot_id) return base;

  const semana = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId }, select: { fecha_inicio: true, fecha_fin: true } });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  // Las fechas de consumo y recepción se normalizan al día civil local;
  // este límite incluye completo el domingo de la semana consultada.
  const limiteSemanaDb = new Date(`${iso(semana.fecha_fin)}T23:59:59.999Z`);

  const [productos, aperturaLineas, cierreLineas, comprasLotes, ajustesLotes, lotesLedger, consumos, consumosLedger, consumosAjuste, consumosAnteriores, unidadesCaptura, reversionesHistorial] = await Promise.all([
    prisma.products.findMany({ where: { negocio_id: negocioId, active: true }, select: { id: true, name: true, unidad_base: true, unidad_compra: true, contenido_compra: true, unit_cost: true } }),
    prisma.inventory_lines.findMany({ where: { snapshot_id: semanal.apertura_snapshot_id }, select: { product_id: true, zona_id: true, qty_captura: true, factor: true } }),
    prisma.inventory_lines.findMany({ where: { snapshot_id: semanal.cierre_snapshot_id }, select: { product_id: true, zona_id: true, qty_captura: true, factor: true } }),
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, purchase_id: { not: null }, recibido_at: { gte: semana.fecha_inicio, lte: limiteSemanaDb } },
      select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
    }),
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, fuente: 'ajuste_inventario', ticket_ref: { startsWith: `AJUSTE-INVENTARIO-${semanaId}-` } },
      select: { id: true, product_id: true, cantidad_inicial: true, costo_unitario: true },
    }),
    // FIFO es un libro continuo. No lo reiniciamos al cambiar de semana:
    // todos los lotes recibidos hasta el cierre participan en la existencia
    // esperada y los que cruzan semanas. La selección final es por producto:
    // si existe lote operativo se usa ese libro; si no, se conserva el saldo
    // histórico para no convertir una línea omitida del snapshot en faltante.
    prisma.inventory_lots.findMany({
      where: { negocio_id: negocioId, recibido_at: { lte: limiteSemanaDb }, estado: { in: ['abierto', 'agotado'] } },
      select: { id: true, product_id: true, recibido_at: true, cantidad_inicial: true, costo_unitario: true, fuente: true, purchase_id: true },
    }),
    prisma.inventory_consumptions.findMany({
      // Esta colección alimenta consumo teórico: sólo ventas FIFO activas.
      // Las reversiones no se vuelven a restar en una conciliación.
      where: {
        negocio_id: negocioId,
        fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb },
        ...filtroConsumoFifoActivo(),
      },
      select: { product_id: true, lote_id: true, cantidad: true, fuente: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { lte: limiteSemanaDb }, ...filtroConsumoFifoActivo({ incluirAjustes: true }) },
      select: { product_id: true, lote_id: true, cantidad: true, fuente: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb }, fuente: 'ajuste_inventario' },
      select: { product_id: true, cantidad: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { lt: semana.fecha_inicio }, ...filtroConsumoFifoActivo({ incluirAjustes: true }) },
      select: { product_id: true, lote_id: true, cantidad: true, fuente: true },
    }),
    prisma.product_zone_units.findMany({
      where: { products: { negocio_id: negocioId } },
      select: { product_id: true, zona_id: true, unidad_captura: true, factor: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.fecha_inicio, lte: limiteSemanaDb }, fuente: { startsWith: 'reversion_' } },
      select: { id: true },
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
  const factoresDe = (lineas: { product_id: bigint; factor: unknown }[]) => {
    const mapa = new Map<string, number[]>();
    for (const linea of lineas) {
      const key = linea.product_id.toString();
      const factor = num0(linea.factor as never);
      const lista = mapa.get(key) ?? [];
      if (!lista.includes(factor)) lista.push(factor);
      mapa.set(key, lista);
    }
    return mapa;
  };
  const factoresApertura = factoresDe(aperturaLineas);
  const factoresCierre = factoresDe(cierreLineas);
  const unidadCapturaPorZona = new Map(unidadesCaptura.map((u) => [`${u.product_id}:${u.zona_id}`, { unidad: u.unidad_captura, factor: num0(u.factor) }]));
  const presentacionesDe = (lineas: { product_id: bigint; zona_id: bigint; qty_captura: unknown; factor: unknown }[], productId: string, producto: { unidad_base: string | null } | undefined) => lineas
    .filter((linea) => linea.product_id.toString() === productId)
    .map((linea) => {
      const ref = unidadCapturaPorZona.get(`${linea.product_id}:${linea.zona_id}`);
      return {
        zona_id: Number(linea.zona_id),
        unidad: ref?.unidad ?? producto?.unidad_base ?? 'unidad base',
        cantidad: redondearCantidad(num0(linea.qty_captura as never)),
        factor: redondearCantidad(num0(linea.factor as never)),
      };
    });
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
    if (!esConsumoFifoActivo(consumo)) continue;
    const productoKey = consumo.product_id.toString();
    consumosPorProducto.set(productoKey, redondearCantidad((consumosPorProducto.get(productoKey) ?? 0) + cantidad));
  }
  const consumosLedgerPorLote = new Map<string, number>();
  for (const consumo of consumosLedger) {
    const loteKey = consumo.lote_id.toString();
    consumosLedgerPorLote.set(loteKey, redondearCantidad((consumosLedgerPorLote.get(loteKey) ?? 0) + num0(consumo.cantidad)));
  }
  const consumosAnterioresPorLote = new Map<string, number>();
  for (const consumo of consumosAnteriores) {
    const loteKey = consumo.lote_id.toString();
    consumosAnterioresPorLote.set(loteKey, redondearCantidad((consumosAnterioresPorLote.get(loteKey) ?? 0) + num0(consumo.cantidad)));
  }
  const lotesPorProducto = new Map<string, { id: bigint; cantidad: number; costo: number }[]>();
  const lotesPorProductoRaw = new Map<string, typeof lotesLedger>();
  for (const lote of lotesLedger) {
    const key = lote.product_id.toString();
    const lista = lotesPorProductoRaw.get(key) ?? [];
    lista.push(lote);
    lotesPorProductoRaw.set(key, lista);
  }
  for (const [key, lista] of lotesPorProductoRaw) {
    const vivos = lista.filter((lote) => lote.fuente !== 'historico_prueba');
    const seleccionados = vivos.length ? vivos : lista;
    lotesPorProducto.set(key, seleccionados.map((lote) => ({ id: lote.id, cantidad: num0(lote.cantidad_inicial), costo: num0(lote.costo_unitario) })));
  }
  const lotesSeleccionadosIds = new Set([...lotesPorProducto.values()].flatMap((lista) => lista.map((lote) => lote.id.toString())));
  const lotesAperturaPorProducto = new Map<string, { id: bigint; cantidad: number; costo: number }[]>();
  const lotesAperturaRaw = new Map<string, typeof lotesLedger>();
  for (const lote of lotesLedger) {
    // La apertura incluye todo lo recibido antes del lunes y también los
    // lotes de inventario inicial creados ese mismo lunes. Una compra real
    // recibida el lunes no pertenece a la apertura: se suma en
    // `compras_recibidas` para no contarla dos veces.
    const fechaLote = iso(lote.recibido_at);
    const fechaInicio = iso(semana.fecha_inicio);
    const esLoteInicialDelDia = fechaLote === fechaInicio && lote.fuente === 'inventario_inicial' && lote.purchase_id == null;
    if (fechaLote > fechaInicio || (fechaLote === fechaInicio && !esLoteInicialDelDia)) continue;
    const key = lote.product_id.toString();
    const lista = lotesAperturaRaw.get(key) ?? [];
    lista.push(lote);
    lotesAperturaRaw.set(key, lista);
  }
  for (const [key, lista] of lotesAperturaRaw) {
    const vivos = lista.filter((lote) => lote.fuente !== 'historico_prueba');
    const seleccionados = vivos.length ? vivos : lista;
    lotesAperturaPorProducto.set(key, seleccionados.map((lote) => ({ id: lote.id, cantidad: num0(lote.cantidad_inicial), costo: num0(lote.costo_unitario) })));
  }
  // Durante la transición puede haber ventas de esta semana que fueron
  // consumidas contra un lote histórico antes de que existiera el lote
  // operativo de apertura. No sumamos ese lote histórico, pero sí descontamos
  // ese consumo del saldo operativo del producto para que la conciliación no
  // muestre una existencia completa artificial.
  const consumosHistoricosSemanaPorProducto = new Map<string, number>();
  for (const consumo of consumos) {
    if (!esConsumoFifoActivo(consumo) || lotesSeleccionadosIds.has(consumo.lote_id.toString())) continue;
    const key = consumo.product_id.toString();
    consumosHistoricosSemanaPorProducto.set(key, redondearCantidad((consumosHistoricosSemanaPorProducto.get(key) ?? 0) + num0(consumo.cantidad)));
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
    // Consumo inferido desde el movimiento físico: lo que había, más lo
    // recibido y ajustado, menos lo contado al cierre. Esta cifra es
    // independiente del costo FIFO y permite detectar merma o captura.
    const consumoFisicoInferido = redondearCantidad(inicial + comprasRecibidas + ajusteInventario - fisico);
    const diferenciaConsumo = redondearCantidad(consumoFisicoInferido - consumo);
    const lotes = lotesPorProducto.get(key) ?? [];
    const costoPresentacion = producto?.unit_cost == null ? null : num0(producto.unit_cost);
    const contenidoCompra = producto?.contenido_compra == null ? null : num0(producto.contenido_compra);
    const costoCatalogo = costoPresentacion == null
      ? null
      : producto?.unidad_base && contenidoCompra != null && contenidoCompra > 0
        ? costoPresentacion / contenidoCompra
        : costoPresentacion;
    const tieneAperturaFifo = lotesAperturaPorProducto.has(key);
    const saldoSeleccionado = lotes.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosLedgerPorLote.get(lote.id.toString()) ?? 0)), 0);
    const valorSeleccionado = lotes.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosLedgerPorLote.get(lote.id.toString()) ?? 0)) * lote.costo, 0);
    const consumoHistoricoDeLaSemana = consumosHistoricosSemanaPorProducto.get(key) ?? 0;
    const fifoRestante = Math.max(0, saldoSeleccionado - consumoHistoricoDeLaSemana);
    const costoSeleccionado = saldoSeleccionado > 0.0001 ? valorSeleccionado / saldoSeleccionado : 0;
    const fifoValorRestante = Math.max(0, valorSeleccionado - consumoHistoricoDeLaSemana * costoSeleccionado);
    const esperado = redondearCantidad(fifoRestante);
    // Diferencia contra el libro FIFO (informativa) y residuo de la semana
    // contra el movimiento físico independiente. Sólo el segundo puede
    // convertirse en una posible merma después de resolver apertura,
    // conversiones y compras faltantes.
    const diferenciaFifo = redondearCantidad(fisico - esperado);
    const lotesApertura = lotesAperturaPorProducto.get(key) ?? [];
    const saldoFifoApertura = lotesApertura.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosAnterioresPorLote.get(lote.id.toString()) ?? 0)), 0);
    const valorFifoApertura = lotesApertura.reduce((suma, lote) => suma + Math.max(0, lote.cantidad - (consumosAnterioresPorLote.get(lote.id.toString()) ?? 0)) * lote.costo, 0);
    const fifoApertura = redondearCantidad(saldoFifoApertura);
    const diferenciaApertura = redondearCantidad(inicial - fifoApertura);
    // Las líneas se guardan convertidas a unidad base. Un cambio de
    // presentación (por ejemplo, caja frente a piezas) no es por sí mismo
    // una diferencia: el factor ya está aplicado en cada snapshot. Sólo una
    // corrección explícita de conversión debe alimentar este campo; de lo
    // contrario se convertiría un cambio legítimo de cantidad en una falsa
    // merma. Las cantidades de captura y factores se exponen para que el
    // operador pueda auditar el caso sin alterar el saldo.
    const diferenciaConversion = 0;
    const existenciaEsperadaMovimientos = redondearCantidad(inicial + comprasRecibidas + ajusteInventario - consumo);
    const diferenciaSemana = redondearCantidad(fisico - existenciaEsperadaMovimientos);
    const costoPonderado = fifoRestante > 0.0001
      ? Math.round((fifoValorRestante / fifoRestante) * 1_000_000) / 1_000_000
      : lotes.length
        ? Math.round((lotes.reduce((suma, lote) => suma + lote.cantidad * lote.costo, 0) / Math.max(lotes.reduce((suma, lote) => suma + lote.cantidad, 0), 0.0001)) * 1_000_000) / 1_000_000
        : costoCatalogo;
    const costoApertura = fifoApertura > 0.0001 ? valorFifoApertura / fifoApertura : costoPonderado;
    const incidenciaClasificada = clasificarIncidencia({
      diferencia: diferenciaSemana,
      diferenciaConsumo,
      diferenciaApertura,
      diferenciaConversion,
      inicial,
      compras: comprasRecibidas,
      unidadBase: producto?.unidad_base ?? null,
      unidadCompra: producto?.unidad_compra ?? null,
      contenidoCompra,
      factoresApertura: factoresApertura.get(key) ?? [],
      factoresCierre: factoresCierre.get(key) ?? [],
      tieneAperturaFifo,
    });
    return {
      product_id: Number(key),
      producto: producto?.name ?? `Producto ${key}`,
      unidad_base: producto?.unidad_base ?? null,
      presentacion_apertura: presentacionesDe(aperturaLineas, key, producto),
      presentacion_cierre: presentacionesDe(cierreLineas, key, producto),
      inventario_inicial: inicial,
      fifo_apertura: fifoApertura,
      diferencia_apertura: diferenciaApertura,
      diferencia_apertura_valor: costoApertura == null ? null : redondear(diferenciaApertura * costoApertura),
      compras_recibidas: comprasRecibidas,
      ajustes_inventario: ajusteInventario,
      consumo_teorico: consumo,
      consumo_fifo_activo: consumo,
      consumo_fisico_inferido: consumoFisicoInferido,
      diferencia_consumo: diferenciaConsumo,
      diferencia_conversion: diferenciaConversion,
      existencia_esperada_movimientos: existenciaEsperadaMovimientos,
      diferencia_semana: diferenciaSemana,
      existencia_fifo_esperada: esperado,
      inventario_fisico_final: fisico,
      diferencia_fifo: diferenciaFifo,
      diferencia_fifo_valor: costoPonderado == null ? null : redondear(diferenciaFifo * costoPonderado),
      diferencia_cantidad: diferenciaSemana,
      costo_fifo: costoPonderado,
      costo_fifo_apertura: costoApertura == null ? null : redondear(costoApertura),
      diferencia_valor: costoPonderado == null ? null : redondear(diferenciaSemana * costoPonderado),
      incidencia_tipo: incidenciaClasificada.tipo,
      incidencia: incidenciaClasificada.texto,
    } satisfies FilaConciliacionInventario;
  }).sort((a, b) => Math.abs(b.diferencia_valor ?? b.diferencia_cantidad) - Math.abs(a.diferencia_valor ?? a.diferencia_cantidad));

  const conIncidencia = filas.filter((fila) => fila.incidencia_tipo !== 'sin_diferencia');
  const consumoActivoFilas = consumos.filter((row) => esConsumoFifoActivo(row)).length;
  const reversionesHistorialFilas = reversionesHistorial.length;
  const diferenciasConsumo = filas.filter((fila) => Math.abs(fila.diferencia_consumo) > 0.01);
  const diferenciaAperturaValor = filas.reduce((total, fila) => total + (fila.diferencia_apertura_valor ?? 0), 0);
  const diferenciaConversionValor = filas.reduce((total, fila) => total + (fila.costo_fifo == null ? 0 : fila.diferencia_conversion * fila.costo_fifo), 0);
  const diferenciaSemanaValor = filas.reduce((total, fila) => total + (fila.costo_fifo == null ? 0 : fila.diferencia_semana * fila.costo_fifo), 0);
  const reporteIndependiente = Boolean(
    semanal.cierre_snapshot_id &&
    diferenciasConsumo.length === 0 &&
    filas.every((fila) => Math.abs(fila.diferencia_apertura) <= 0.01
      && Math.abs(fila.diferencia_conversion) <= 0.01
      && Math.abs(fila.diferencia_semana) <= 0.01),
  );
  return {
    ...base,
    filas,
    // El total principal es el residuo semanal; la divergencia FIFO se
    // conserva en cada fila para auditoría, pero no se presenta como merma.
    total_diferencia_valor: filas.some((fila) => fila.diferencia_valor != null)
      ? redondear(filas.reduce((suma, fila) => suma + (fila.diferencia_valor ?? 0), 0))
      : null,
    productos_con_incidencia: conIncidencia.length,
    consumo_fifo_activo_filas: consumoActivoFilas,
    reversiones_historial_filas: reversionesHistorialFilas,
    productos_con_diferencia_consumo: diferenciasConsumo.length,
    diferencia_apertura_valor: redondear(diferenciaAperturaValor),
    diferencia_conversion_valor: redondear(diferenciaConversionValor),
    diferencia_semana_valor: redondear(diferenciaSemanaValor),
    conciliacion_apertura: {
      inventario_fisico: redondear(filas.reduce((total, fila) => total + fila.inventario_inicial * (fila.costo_fifo_apertura ?? fila.costo_fifo ?? 0), 0)),
      fifo: redondear(filas.reduce((total, fila) => total + fila.fifo_apertura * (fila.costo_fifo_apertura ?? fila.costo_fifo ?? 0), 0)),
      diferencia_historica: redondear(diferenciaAperturaValor),
      diferencia_conversion: redondear(diferenciaConversionValor),
    },
    reporte_independiente: reporteIndependiente,
    alerta_independencia: reporteIndependiente
      ? null
      : 'El cierre aún no es independiente: separa la diferencia histórica, las conversiones y el residuo semanal antes de llamarlo merma.',
  };
}

/**
 * Congela la conciliación calculada para que el cierre tenga una evidencia
 * consultable y no dependa de repetir el cálculo con datos que pudieron
 * cambiar después. La operación es idempotente: cada recálculo reemplaza
 * únicamente las filas de esa semana y nunca toca snapshots, lotes ni ventas.
 */
export async function persistirConciliacionInventarioSemana(negocioId: bigint, semanaId: bigint) {
  const conciliacion = await conciliacionInventarioSemana(negocioId, semanaId);
  if (conciliacion.estado === 'pendiente_cierre' || conciliacion.cierre_snapshot_id == null) {
    return { ...conciliacion, persistida: false, filas_persistidas: 0 };
  }

  await prisma.$transaction(async (tx) => {
    // Dos recálculos simultáneos deben comportarse como uno solo. El lock es
    // transaccional y sólo bloquea la combinación negocio/semana actual.
    const lockKey = negocioId * 1_000_000n + semanaId;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    await tx.inventory_fifo_reconciliations.deleteMany({
      where: { negocio_id: negocioId, semana_id: semanaId },
    });
    if (!conciliacion.filas.length) return;
    await tx.inventory_fifo_reconciliations.createMany({
      data: conciliacion.filas.map((fila) => ({
        negocio_id: negocioId,
        semana_id: semanaId,
        product_id: BigInt(fila.product_id),
        // El registro persistido compara explícitamente el saldo FIFO con el
        // conteo físico. El residuo de movimientos queda en notas para no
        // mezclar una diferencia de semana con una diferencia de apertura.
        apertura_qty: fila.inventario_inicial,
        compras_qty: fila.compras_recibidas,
        consumo_teorico_qty: fila.consumo_fifo_activo,
        fifo_esperado_qty: fila.existencia_fifo_esperada,
        fisico_final_qty: fila.inventario_fisico_final,
        diferencia_qty: fila.diferencia_fifo,
        costo_unitario_fifo: fila.costo_fifo ?? 0,
        diferencia_valor: fila.diferencia_fifo_valor ?? 0,
        tipo_incidencia: fila.incidencia_tipo,
        estado: fila.incidencia_tipo === 'sin_diferencia' ? 'resuelta' : 'pendiente',
        notas: JSON.stringify({
          producto: fila.producto,
          unidad_base: fila.unidad_base,
          ajustes_inventario: fila.ajustes_inventario,
          existencia_esperada_movimientos: fila.existencia_esperada_movimientos,
          diferencia_semana: fila.diferencia_semana,
          diferencia_consumo: fila.diferencia_consumo,
          diferencia_apertura: fila.diferencia_apertura,
          incidencia: fila.incidencia,
        }),
      })),
    });
  }, { timeout: 20000, maxWait: 15000 });

  return { ...conciliacion, persistida: true, filas_persistidas: conciliacion.filas.length };
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

async function movimientosDeSemana(negocioId: bigint, semanaId: bigint) {
  return prisma.movimientos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { id: 'asc' } });
}

export async function listarMovimientos(negocioId: bigint, semanaId: bigint) {
  await getSemanaAbierta(negocioId, semanaId);
  const movs = await movimientosDeSemana(negocioId, semanaId);
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
  const movs = await movimientosDeSemana(negocioId, semanaId);
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
      where: { negocio_id: negocioId, semana_id: semanaId, fecha: fechaDate, descripcion: { in: MARCAS_DIA } },
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
    movimientosDeSemana(negocioId, semanaId),
    mapaSaldoInicial(negocioId, semana.fecha_inicio),
  ]);
  const teoricos = calcularSaldosTeoricos(inicialMap, movs.map(aMovBalance));

  // Último arqueo por ubicación dentro de la semana.
  const arqueos = await prisma.arqueos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { id: 'desc' } });
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

export type ExcepcionCosteoSemana = {
  producto: string;
  estado: 'pendiente' | 'excepcion';
  causa: 'mapeo' | 'receta' | 'inventario' | 'captura';
  accion: string;
  lineas: number;
  unidades: number;
  venta: number;
  detalles: string[];
};

/**
 * Agrupa la cola de costeo por causa raíz. Una venta repetida no debe obligar
 * al operador a leer el mismo mensaje diez veces: la unidad de trabajo es
 * producto + causa y conserva el importe afectado para priorizarla.
 */
export async function listarExcepcionesCosteoSemana(negocioId: bigint, semanaId: bigint): Promise<ExcepcionCosteoSemana[]> {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const rango = rangoEposSemana(semana.fecha_inicio, semana.fecha_fin);
  const filas = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: negocioId,
      fecha: { gte: rango.inicio, lt: rango.fin },
      costeo_estado: { in: ['pendiente', 'excepcion'] },
    },
    select: { producto_nombre: true, costeo_estado: true, costeo_error: true, cantidad: true, venta_neta: true, venta_bruta: true },
  });
  const grupos = new Map<string, ExcepcionCosteoSemana>();
  for (const fila of filas) {
    const error = fila.costeo_error ?? 'Revisión de costeo pendiente';
    const lower = error.toLocaleLowerCase('es-MX');
    const causa: ExcepcionCosteoSemana['causa'] = lower.includes('sin mapeo')
      ? 'mapeo'
      : lower.includes('inventario insuficiente')
        ? 'inventario'
        : lower.includes('receta') || lower.includes('unidad pendiente')
          ? 'receta'
          : 'captura';
    const key = `${fila.producto_nombre}\u0000${causa}`;
    const actual = grupos.get(key);
    const venta = num0(fila.venta_neta ?? fila.venta_bruta);
    const cantidad = num0(fila.cantidad);
    const acciones: Record<ExcepcionCosteoSemana['causa'], string> = {
      mapeo: 'Asociar el producto Epos a un producto del menú.',
      receta: 'Validar la receta y sus unidades; no repetir una receta ya validada.',
      inventario: 'Revisar lote FIFO recibido y existencia disponible.',
      captura: 'Revisar cantidad, fecha o captura de la venta.',
    };
    if (actual) {
      actual.lineas += 1;
      actual.unidades = redondear(actual.unidades + cantidad);
      actual.venta = redondear(actual.venta + venta);
      if (actual.detalles.length < 3 && !actual.detalles.includes(error)) actual.detalles.push(error);
    } else {
      grupos.set(key, {
        producto: fila.producto_nombre,
        estado: fila.costeo_estado === 'excepcion' ? 'excepcion' : 'pendiente',
        causa,
        accion: acciones[causa],
        lineas: 1,
        unidades: redondear(cantidad),
        venta: redondear(venta),
        detalles: [error],
      });
    }
  }
  return [...grupos.values()].sort((a, b) => b.venta - a.venta || b.lineas - a.lineas || a.producto.localeCompare(b.producto));
}

export async function resumen(negocioId: bigint, semanaId: bigint) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  const rangoEpos = rangoEposSemana(semana.fecha_inicio, semana.fecha_fin);
  const [ubicaciones, movs, inicialMap, socios, eposSemana, eposPendientes] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true } }),
    movimientosDeSemana(negocioId, semanaId),
    mapaSaldoInicial(negocioId, semana.fecha_inicio),
    prisma.socios.findMany({ where: { negocio_id: negocioId, activo: true } }),
    prisma.epos_ventas.aggregate({
      where: { negocio_id: negocioId, fecha: { gte: rangoEpos.inicio, lt: rangoEpos.fin } },
      _sum: { venta_neta: true, venta_bruta: true },
      _count: { _all: true },
    }),
    prisma.epos_ventas.aggregate({
      where: { negocio_id: negocioId, fecha: { gte: rangoEpos.inicio, lt: rangoEpos.fin }, costeo_estado: { in: ['pendiente', 'excepcion'] } },
      _sum: { venta_neta: true, venta_bruta: true },
      _count: { _all: true },
    }),
  ]);

  const ventaEfectivo = sumarPorTipo(movs, 'venta_efectivo');
  const ventaTarjeta = sumarPorTipo(movs, 'venta_tarjeta');
  const propinaTarjeta = sumarPorTipo(movs, 'propina_tarjeta');
  const comprasInventario = sumarPorTipo(movs, 'compra_inventario');
  const gastosFacturados = redondear(movs.filter((m) => m.facturado).reduce((a, m) => a + num0(m.monto as never), 0));

  // Saldo real final: arqueo si hay, si no teórico (igual que en el cierre).
  const teoricos = calcularSaldosTeoricos(inicialMap, movs.map(aMovBalance));
  const arqueos = await prisma.arqueos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { id: 'desc' } });
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
  const excepciones_costeo = await listarExcepcionesCosteoSemana(negocioId, semanaId);
  const pasivosActivos = await sumaPasivosActivos(negocioId);
  // Epos es la fuente de ventas operativas; las propinas se muestran aparte y
  // nunca se confunden con ingreso del negocio. Si todavía no hay Epos
  // importado, dejamos el valor nulo para no inventar un resultado.
  const ventasEpos = eposSemana._count._all > 0
    ? redondear(num0(eposSemana._sum.venta_neta ?? eposSemana._sum.venta_bruta))
    : null;
  const ventasOperativas = ventasEpos ?? null;
  const utilidadBruta = ventasOperativas == null || inventario.costo_ventas == null
    ? null
    : redondear(ventasOperativas - inventario.costo_ventas);
  const gastosOperativos = redondear(
    movs.filter((m) => m.tipo === 'gasto' || m.tipo === 'sueldo' || m.tipo === 'propina_pagada')
      .reduce((sum, m) => sum + num0(m.monto as never), 0),
  );
  const resultadoOperativo = utilidadBruta == null
    ? null
    : redondear(utilidadBruta - comisionTerminal(ventaTarjeta, propinaTarjeta) - gastosOperativos);
  const resultadoIndependiente = Boolean(conciliacion_inventario.reporte_independiente && (inventario.control_fifo?.reporte_independiente ?? false) && eposPendientes._count._all === 0);
  // El patrimonio representa activos físicos comprobados, no el valor bruto
  // del ledger FIFO. Si la semana sigue abierta sin conteo, se deja pendiente
  // para no mostrar una cifra inflada como si fuera patrimonio real.
  const patrimonioActivos = inventario.valor_patrimonio == null
    ? null
    : redondear(saldoRealFinalTotal + inventario.valor_patrimonio);
  const patrimonioNeto = patrimonioActivos == null
    ? null
    : redondear(patrimonioActivos - pasivosActivos);

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
    flujo_caja_neto: r.flujoCajaNeto,
    margen_flujo_caja: ventasOperativas == null || ventasOperativas === 0 ? null : redondear(r.flujoCajaNeto / ventasOperativas),
    utilidad: r.utilidad,
    margen: r.margen,
    utilidad_pct: r.utilidadPct,
    ventas_operativas: ventasOperativas,
    utilidad_bruta: utilidadBruta,
    utilidad_bruta_estado: utilidadBruta == null ? 'pendiente' : resultadoIndependiente ? 'verificada' : 'provisional_fifo',
    resultado_operativo: resultadoOperativo,
    resultado_operativo_estado: resultadoOperativo == null ? 'pendiente' : resultadoIndependiente ? 'verificado' : 'provisional_fifo',
    costo_ventas_fifo_activo: inventario.costo_ventas,
    ventas_epos_pendientes: eposPendientes._count._all,
    importe_ventas_epos_pendientes: redondear(num0(eposPendientes._sum.venta_neta ?? eposPendientes._sum.venta_bruta)),
    excepciones_costeo,
    resultado_independiente: resultadoIndependiente,
    patrimonio_activos: patrimonioActivos,
    pasivos_activos: pasivosActivos,
    patrimonio_neto: patrimonioNeto,
    diferencia_fisica_valor: conciliacion_inventario.total_diferencia_valor,
    facturado: { tarjeta_facturable: r.tarjetaFacturable, gastos_facturados: r.gastosFacturados, balance: r.balanceFacturado },
    capital_socios: capital,
    saldo_inicial_total: redondear(saldoInicialTotal),
    saldo_real_final_total: redondear(saldoRealFinalTotal),
  };
}

/**
 * Mando de decisiones para dirección. Consolida las últimas semanas sin
 * crear saldos paralelos: ventas y costo salen del resumen semanal; FIFO sólo
 * se usa para medir consumo, rotación y cobertura cuando hay datos suficientes.
 */
export async function tableroDecisiones(negocioId: bigint, limite = 8) {
  const n = Math.min(Math.max(Math.trunc(limite) || 8, 2), 16);
  const semanas = await prisma.semanas.findMany({
    where: { negocio_id: negocioId },
    orderBy: { fecha_inicio: 'desc' },
    take: n,
  });
  const ordenadas = [...semanas].reverse();
  const filas = await Promise.all(ordenadas.map(async (semana) => {
    const r = await resumen(negocioId, semana.id);
    const ventas = r.ventas_operativas ?? r.ventas.total;
    const costo = r.costo_ventas_fifo_activo;
    const foodCost = ventas > 0 && costo != null ? redondear((costo / ventas) * 100) : null;
    const margen = ventas > 0 && r.resultado_operativo != null ? redondear((r.resultado_operativo / ventas) * 100) : null;
    const inventarioInicial = r.inventario.apertura_valor;
    const inventarioFinal = r.inventario.cierre_valor ?? r.inventario.valor_fisico_actual;
    const inventarioPromedio = inventarioInicial != null && inventarioFinal != null
      ? (inventarioInicial + inventarioFinal) / 2
      : inventarioFinal;
    const rotacion = costo != null && inventarioPromedio != null && inventarioPromedio > 0 ? redondear(costo / inventarioPromedio) : null;
    const cobertura = costo != null && costo > 0 && inventarioFinal != null ? redondear(inventarioFinal / costo) : null;
    const incidenciasInventario = r.conciliacion_inventario.filas
      .filter((f) => f.incidencia_tipo !== 'sin_diferencia')
      .map((f) => ({ producto: f.producto, incidencia: f.incidencia, tipo: f.incidencia_tipo }));
    return {
      semana_id: Number(semana.id), etiqueta: etiquetaCanonica(semana.fecha_inicio, semana.fecha_fin),
      fecha_inicio: iso(semana.fecha_inicio), fecha_fin: iso(semana.fecha_fin), estado: semana.estado,
      ventas, costo_ventas: costo, food_cost_pct: foodCost, utilidad_operativa: r.resultado_operativo,
      margen_operativo_pct: margen, compras_inventario: r.compras_inventario,
      inventario_final: inventarioFinal, rotacion_semanal: rotacion, cobertura_semanas: cobertura,
      excepciones_costeo: r.excepciones_costeo.length, ventas_epos_pendientes: r.ventas_epos_pendientes,
      incidencias_inventario: incidenciasInventario, resultado_independiente: r.resultado_independiente,
    };
  }));

  const incidencias: { id: string; semana_id: number; semana: string; tipo: 'costeo' | 'inventario'; responsable: string; fecha_limite: string; accion: string; detalle: string }[] = [];
  for (const fila of filas) {
    if (fila.ventas_epos_pendientes > 0 || fila.excepciones_costeo > 0) {
      incidencias.push({
        id: `costeo-${fila.semana_id}`,
        semana_id: fila.semana_id, semana: fila.etiqueta, tipo: 'costeo', responsable: 'Administración',
        fecha_limite: fila.fecha_fin, accion: 'Resolver mapeo, receta o existencia antes de cerrar',
        detalle: `${fila.excepciones_costeo} excepción(es) FIFO · ${fila.ventas_epos_pendientes} venta(s) Epos pendiente(s)`,
      });
    }
    fila.incidencias_inventario.slice(0, 12).forEach((inc, index) => incidencias.push({
      id: `inventario-${fila.semana_id}-${index}`, semana_id: fila.semana_id, semana: fila.etiqueta,
      tipo: 'inventario', responsable: 'Administración', fecha_limite: fila.fecha_fin,
      accion: 'Comparar conteo físico, compras y consumo FIFO', detalle: `${inc.producto}: ${inc.incidencia}`,
    }));
  }

  const alertas: { tipo: 'costo_creciente' | 'baja_rotacion' | 'diferencia_recurrente'; severidad: 'media' | 'alta'; semana_id: number; mensaje: string; valor: number | null; referencia: number | null }[] = [];
  for (let i = 1; i < filas.length; i += 1) {
    const actual = filas[i]!; const anterior = filas[i - 1]!;
    if (actual.food_cost_pct != null && anterior.food_cost_pct != null && actual.food_cost_pct - anterior.food_cost_pct >= 5) {
      alertas.push({ tipo: 'costo_creciente', severidad: 'alta', semana_id: actual.semana_id, mensaje: `Food cost subió ${redondear(actual.food_cost_pct - anterior.food_cost_pct)} puntos frente a ${anterior.etiqueta}`, valor: actual.food_cost_pct, referencia: anterior.food_cost_pct });
    }
  }
  const ultima = filas[filas.length - 1];
  if (ultima?.cobertura_semanas != null && ultima.cobertura_semanas >= 4) {
    alertas.push({ tipo: 'baja_rotacion', severidad: 'media', semana_id: ultima.semana_id, mensaje: `El inventario cubre aproximadamente ${ultima.cobertura_semanas} semanas de costo`, valor: ultima.cobertura_semanas, referencia: 4 });
  }
  const repetidas = new Map<string, number>();
  filas.forEach((fila) => fila.incidencias_inventario.forEach((inc) => repetidas.set(inc.producto, (repetidas.get(inc.producto) ?? 0) + 1)));
  repetidas.forEach((veces, producto) => {
    if (veces >= 2 && ultima) alertas.push({ tipo: 'diferencia_recurrente', severidad: 'alta', semana_id: ultima.semana_id, mensaje: `${producto} presenta diferencias en ${veces} semanas`, valor: veces, referencia: 2 });
  });
  const conBloqueador = filas.filter((f) => f.excepciones_costeo > 0 || f.ventas_epos_pendientes > 0 || f.incidencias_inventario.length > 0).length;
  return {
    generado_at: new Date().toISOString(), semanas: filas, incidencias: incidencias.slice(0, 80), alertas,
    salud: { semanas_consultadas: filas.length, semanas_con_bloqueadores: conBloqueador, incidencias_abiertas: incidencias.length, alertas_activas: alertas.length },
  };
}

// ---------------------------------------------------------------------------
//  Cierre de semana
// ---------------------------------------------------------------------------
export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, semanaId: bigint, _confirmarExcepciones = false) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  // El cierre no debe ocultar ventas que no pudieron convertirse en consumo
  // FIFO. Permitimos continuar únicamente después de una confirmación explícita
  // para que la excepción quede visible y no se interprete como margen real.
  const rangoEpos = rangoEposSemana(semana.fecha_inicio, semana.fecha_fin);
  const excepcionesCosteo = await prisma.epos_ventas.findMany({
    where: {
      negocio_id: negocioId,
      fecha: { gte: rangoEpos.inicio, lt: rangoEpos.fin },
      costeo_estado: { in: ['pendiente', 'excepcion'] },
    },
    select: { id: true, producto_nombre: true, cantidad: true, costeo_estado: true, costeo_error: true },
    orderBy: { fecha: 'asc' },
    take: 100,
  });
  if (excepcionesCosteo.length) {
    throw new HttpError(409, `Hay ${excepcionesCosteo.length} excepciones de costeo pendientes antes de cerrar la semana`, {
      tipo: 'excepciones_costeo',
      total: excepcionesCosteo.length,
      ventas: excepcionesCosteo.map((fila) => ({ id: Number(fila.id), producto: fila.producto_nombre, cantidad: Number(fila.cantidad), estado: fila.costeo_estado, error: fila.costeo_error })),
      instruccion: 'Revisa el mapeo, las recetas y el inventario; el cierre se habilita cuando todas las ventas tengan costo FIFO activo.',
    });
  }

  // La semana debe tener una apertura congelada antes de registrar su cierre.
  await asegurarInventarioSemanal(negocioId, semanaId);

  const [ubicaciones, banco, semanal] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true } }),
    prisma.ubicaciones_fondos.findFirst({ where: { negocio_id: negocioId, tipo: 'banco' }, orderBy: { id: 'asc' } }),
    prisma.inventario_semanal.findFirst({ where: { semana_id: semanaId, negocio_id: negocioId } }),
  ]);
  if (!semanal) throw new HttpError(409, 'La semana no tiene ciclo de inventario inicializado');

  // Si ya existe un snapshot de cierre oficial (por ejemplo, el conteo hecho
  // el domingo y guardado antes de cerrar), se reutiliza. Crear otro aquí
  // duplicaba el conteo y hacía que el usuario no supiera cuál era el cierre
  // verdadero. Sólo aceptamos un snapshot explícitamente marcado como cierre.
  let cierreSnapshotId = semanal.cierre_snapshot_id;
  if (cierreSnapshotId == null) {
    const cierreCapturado = await prisma.inventory_snapshot.findFirst({
      where: { negocio_id: negocioId, semana_id: semanaId, tipo: 'cierre' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    cierreSnapshotId = cierreCapturado?.id ?? null;
    if (cierreSnapshotId != null) {
      const cierreValor = await valorSnapshot(negocioId, cierreSnapshotId);
      await prisma.inventario_semanal.update({
        where: { semana_id: semanaId },
        data: { cierre_snapshot_id: cierreSnapshotId, cierre_valor: cierreValor },
      });
    }
  }
  if (cierreSnapshotId == null) {
    throw new HttpError(409, 'Falta el inventario físico de cierre de esta semana; captura y guarda un snapshot marcado como cierre antes de cerrar');
  }
  const cierreSnapshotValido = await prisma.inventory_snapshot.findFirst({
    where: {
      id: cierreSnapshotId,
      negocio_id: negocioId,
      semana_id: semanaId,
      tipo: { in: ['cierre', 'ajuste'] },
    },
    select: { id: true },
  });
  if (!cierreSnapshotValido) {
    throw new HttpError(409, 'El snapshot de cierre no pertenece a esta semana o no está marcado como cierre');
  }
  // El cierre contable usa exclusivamente el valor del conteo físico de esta
  // semana. El ledger FIFO se conserva como control independiente y nunca
  // sustituye al inventario contado; hacerlo inflaría patrimonio y cierre
  // cuando existan lotes abiertos de semanas anteriores.
  const valorInventario = await valorSnapshot(negocioId, cierreSnapshotId);

  // La evidencia de inventario se recalcula antes de congelar la caja. Esto
  // deja una instantánea auditable incluso si el usuario sólo consulta el
  // cierre y no entra primero a la pestaña de resumen.
  await persistirConciliacionInventarioSemana(negocioId, semanaId);

  await prisma.$transaction(async (tx) => {
    const movs = await tx.movimientos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId } });

    // Reutiliza el snapshot de cierre ya capturado. Si fue detectado por tipo
    // pero aún no estaba vinculado al ciclo semanal, sólo se completa el
    // vínculo; nunca se crea una segunda fotografía del mismo cierre.
    await tx.inventario_semanal.updateMany({
      where: { semana_id: semanaId, negocio_id: negocioId },
      data: { cierre_snapshot_id: cierreSnapshotId!, cierre_valor: valorInventario },
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
    const movsFinal = await tx.movimientos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId } });
    const inicialMap = await mapaSaldoInicial(negocioId, semana.fecha_inicio);
    const teoricos = calcularSaldosTeoricos(inicialMap, movsFinal.map(aMovBalance));
    const arqueos = await tx.arqueos.findMany({ where: { negocio_id: negocioId, semana_id: semanaId }, orderBy: { id: 'desc' } });
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

    await tx.semanas.updateMany({ where: { id: semanaId, negocio_id: negocioId }, data: { estado: 'cerrada', cerrada_at: new Date() } });

    // Deja preparada la siguiente semana en la misma transacción del cierre.
    // Si ya existe (por ejemplo, cuando el lunes se abrió manualmente), no se
    // modifica ni se reemplaza su apertura; sólo se completa el ciclo si aún
    // no tiene registro de inventario.
    const siguienteInicio = masDias(semana.fecha_fin, 1);
    const siguienteFin = masDias(siguienteInicio, 6);
    const siguiente = await tx.semanas.findFirst({
      where: { negocio_id: negocioId, fecha_inicio: siguienteInicio },
      select: { id: true },
    });
    const siguienteId = siguiente?.id ?? (await tx.semanas.create({
      data: {
        negocio_id: negocioId,
        etiqueta: etiquetaCanonica(siguienteInicio, siguienteFin),
        fecha_inicio: siguienteInicio,
        fecha_fin: siguienteFin,
      },
      select: { id: true },
    })).id;
    const cicloSiguiente = await tx.inventario_semanal.findUnique({ where: { semana_id: siguienteId } });
    if (!cicloSiguiente) {
      await tx.inventario_semanal.create({
        data: {
          negocio_id: negocioId,
          semana_id: siguienteId,
          apertura_snapshot_id: cierreSnapshotId!,
          apertura_valor: valorInventario,
          apertura_origen: 'cierre_semana_anterior',
        },
      });
    }

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
    await tx.cierres_semana.deleteMany({ where: { semana_id: semanaId, semanas: { negocio_id: negocioId } } });
    // La comisión de terminal solo se crea automáticamente al cerrar: se puede borrar sin riesgo.
    await tx.movimientos.deleteMany({ where: { negocio_id: negocioId, semana_id: semanaId, tipo: 'comision_terminal' } });
    // El snapshot de patrimonio del cierre está identificado por (negocio, fecha_fin).
    await tx.snapshots_patrimonio.deleteMany({ where: { negocio_id: negocioId, fecha: semana.fecha_fin } });
    await tx.inventario_semanal.updateMany({
      where: { semana_id: semanaId, negocio_id: negocioId },
      data: { cierre_snapshot_id: null, cierre_valor: null },
    });
    // La conciliación pertenece a un cierre concreto. Al reabrirlo se
    // invalida para evitar que la UI muestre evidencia de un snapshot que ya
    // no es el oficial; se regenerará al volver a cerrar o al recalcular.
    await tx.inventory_fifo_reconciliations.deleteMany({ where: { negocio_id: negocioId, semana_id: semanaId } });
    await tx.semanas.updateMany({ where: { id: semanaId, negocio_id: negocioId }, data: { estado: 'abierta', cerrada_at: null } });
  });

  const actual = await prisma.semanas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!actual) throw new HttpError(404, 'Semana no encontrada');
  return serializarSemana(actual);
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
  const semana = await prisma.semanas.findFirst({ where: { id: mov.semana_id, negocio_id: negocioId } });
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

  const [movs, snapshots, consumosFifo] = await Promise.all([
    prisma.movimientos.findMany({
      where: { negocio_id: negocioId, fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, tipo: true, monto: true, facturado: true, categorias_gasto: { select: { nombre: true } } },
      orderBy: { fecha: 'asc' },
    }),
    prisma.snapshots_patrimonio.findMany({
      where: { negocio_id: negocioId },
      select: { fecha: true, total_inventario: true },
    }),
    prisma.inventory_consumptions.findMany({
      where: { negocio_id: negocioId, fecha: { gte: desde, lte: hasta }, ...filtroConsumoFifoActivo() },
      select: { fecha: true, costo_total: true },
    }),
  ]);

  const costoVentasFifoPorMes: Record<string, number> = {};
  for (const consumo of consumosFifo) {
    const mes = iso(consumo.fecha).slice(0, 7);
    costoVentasFifoPorMes[mes] = redondear((costoVentasFifoPorMes[mes] ?? 0) + num0(consumo.costo_total));
  }

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
    costoVentasFifoPorMes,
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
