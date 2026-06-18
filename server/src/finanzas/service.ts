import type { TipoMovimiento } from '@prisma/client';
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
  type MovBalance,
} from './logic.js';
import { generarSnapshotEnCierre } from '../patrimonio/service.js';
import { inventarioActual } from '../inventario/service.js';

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
  const inicio = lunesDe(fechaInicioStr ? new Date(fechaInicioStr + 'T00:00:00Z') : new Date());
  const fin = masDias(inicio, 6);
  const existe = await prisma.semanas.findFirst({ where: { negocio_id: negocioId, fecha_inicio: inicio } });
  if (existe) throw new HttpError(409, 'Esa semana ya existe');
  const s = await prisma.semanas.create({
    data: {
      negocio_id: negocioId,
      etiqueta: `Semana ${iso(inicio)}`,
      fecha_inicio: inicio,
      fecha_fin: fin,
    },
  });
  return serializarSemana(s);
}

function serializarSemana(s: { id: bigint; etiqueta: string; fecha_inicio: Date; fecha_fin: Date; estado: string; cerrada_at: Date | null }) {
  return {
    id: Number(s.id),
    etiqueta: s.etiqueta,
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
  }));
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
    const sueldos = suma('sueldo', MARCA_SUELDO);
    const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
    return {
      fecha,
      dia: DIA_SEMANA[dow]!,
      venta_efectivo, venta_tarjeta, propina_tarjeta, gasto_efectivo, sueldos,
      total_ventas: redondear(venta_efectivo + venta_tarjeta + propina_tarjeta),
      total_egresos: redondear(gasto_efectivo + sueldos),
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
export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, semanaId: bigint) {
  const semana = await getSemanaAbierta(negocioId, semanaId);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  const [ubicaciones, banco, invActual] = await Promise.all([
    prisma.ubicaciones_fondos.findMany({ where: { negocio_id: negocioId, activo: true } }),
    prisma.ubicaciones_fondos.findFirst({ where: { negocio_id: negocioId, tipo: 'banco' }, orderBy: { id: 'asc' } }),
    inventarioActual(negocioId), // lectura pesada: se hace ANTES de abrir la transacción
  ]);
  const valorInventario = invActual.valor_total;

  await prisma.$transaction(async (tx) => {
    const movs = await tx.movimientos.findMany({ where: { semana_id: semanaId } });

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
