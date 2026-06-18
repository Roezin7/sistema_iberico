// Lógica pura de finanzas (sin DB). Spec §5.1. Aquí van los tests: un error de
// cuadre o de comisión cuesta dinero real.

import type { TipoMovimiento } from '@prisma/client';

export const COMISION_RATE = 0.0199; // 1.99% sobre el total ingresado por tarjeta

export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Comisión de terminal = (ventas_tarjeta + propinas_tarjeta) * 1.99%. */
export function comisionTerminal(ventasTarjeta: number, propinasTarjeta: number): number {
  return redondear((ventasTarjeta + propinasTarjeta) * COMISION_RATE);
}

export interface MovBalance {
  ubicacion_origen_id: number | null;
  ubicacion_destino_id: number | null;
  monto: number;
}

/**
 * Saldo teórico por ubicación = saldo_inicial + Σ destinos − Σ orígenes.
 * Devuelve un mapa ubicacion_id -> saldo.
 */
export function calcularSaldosTeoricos(
  iniciales: Record<number, number>,
  movs: MovBalance[],
): Record<number, number> {
  const saldos: Record<number, number> = { ...iniciales };
  for (const m of movs) {
    if (m.ubicacion_destino_id != null)
      saldos[m.ubicacion_destino_id] = redondear((saldos[m.ubicacion_destino_id] ?? 0) + m.monto);
    if (m.ubicacion_origen_id != null)
      saldos[m.ubicacion_origen_id] = redondear((saldos[m.ubicacion_origen_id] ?? 0) - m.monto);
  }
  return saldos;
}

/** Descuadre = monto_real (arqueo) − saldo_teórico. Positivo = sobrante, negativo = faltante. */
export function descuadre(real: number, teorico: number): number {
  return redondear(real - teorico);
}

export interface ResumenInput {
  saldoInicialTotal: number;
  saldoRealFinalTotal: number;
  ventaEfectivo: number;
  ventaTarjeta: number;
  propinaTarjeta: number;
  comprasInventario: number;
  gastosFacturados: number;
}

export interface ResumenSemana {
  ventasTotales: number;
  utilidad: number;
  margen: number; // utilidad / ventas
  utilidadPct: number; // utilidad / compras_inventario
  tarjetaFacturable: number;
  gastosFacturados: number;
  balanceFacturado: number; // (+/-) = tarjeta_facturable − gastos_facturados
}

export function resumenSemana(i: ResumenInput): ResumenSemana {
  const ventasTotales = redondear(i.ventaEfectivo + i.ventaTarjeta + i.propinaTarjeta);
  const utilidad = redondear(i.saldoRealFinalTotal - i.saldoInicialTotal);
  const tarjetaFacturable = redondear(i.ventaTarjeta + i.propinaTarjeta);
  return {
    ventasTotales,
    utilidad,
    margen: ventasTotales ? redondear(utilidad / ventasTotales) : 0,
    utilidadPct: i.comprasInventario ? redondear(utilidad / i.comprasInventario) : 0,
    tarjetaFacturable,
    gastosFacturados: redondear(i.gastosFacturados),
    balanceFacturado: redondear(tarjetaFacturable - i.gastosFacturados),
  };
}

/**
 * Capital de un socio = Σ transferencias a SU caja fuerte − Σ sus retiros.
 * (La transferencia a caja fuerte sigue siendo capital de la empresa; el retiro lo reduce.)
 */
export function capitalSocio(transferenciasACajaFuerte: number, retiros: number): number {
  return redondear(transferenciasACajaFuerte - retiros);
}

// --- Reglas de qué campos exige cada tipo de movimiento (spec §4.3) -------
export interface ReglaMov {
  requiereOrigen: boolean;
  requiereDestino: boolean;
  requiereCategoria: boolean;
  requiereSocio: boolean;
  facturadoDefault: boolean;
  autogenerado?: boolean; // comision_terminal se crea sola al cerrar
}

export const REGLAS_MOVIMIENTO: Record<TipoMovimiento, ReglaMov> = {
  venta_efectivo: { requiereOrigen: false, requiereDestino: true, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  venta_tarjeta: { requiereOrigen: false, requiereDestino: true, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  propina_tarjeta: { requiereOrigen: false, requiereDestino: true, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  comision_terminal: { requiereOrigen: true, requiereDestino: false, requiereCategoria: false, requiereSocio: false, facturadoDefault: false, autogenerado: true },
  gasto: { requiereOrigen: true, requiereDestino: false, requiereCategoria: true, requiereSocio: false, facturadoDefault: false },
  sueldo: { requiereOrigen: true, requiereDestino: false, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  compra_inventario: { requiereOrigen: true, requiereDestino: false, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  transferencia: { requiereOrigen: true, requiereDestino: true, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  retiro_socio: { requiereOrigen: true, requiereDestino: false, requiereCategoria: false, requiereSocio: true, facturadoDefault: false },
  deposito: { requiereOrigen: true, requiereDestino: true, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
  propina_pagada: { requiereOrigen: true, requiereDestino: false, requiereCategoria: false, requiereSocio: false, facturadoDefault: false },
};
