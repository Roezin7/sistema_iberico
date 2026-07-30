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

// ===========================================================================
//  ESTADO DE RESULTADOS (P&L) MENSUAL
// ===========================================================================
// Se arma sobre los movimientos, agrupados por mes calendario de su fecha (no
// por semana: las semanas cruzan meses). Sólo entran los tipos que representan
// ingreso o gasto real; transferencia y deposito son movimientos internos o de
// financiamiento y no tocan el resultado.
//
// Las propinas SÍ entran en ventas, igual que en resumenSemana. No porque sean
// ingreso del negocio, sino porque su salida ya está descontada: se cobran por
// terminal (entran al banco) y se entregan al personal en efectivo antes de
// capturar la venta en efectivo del día. O sea que venta_efectivo ya viene neta
// de lo entregado; dejar las propinas fuera de ventas restaría esa salida dos
// veces y subestimaría la utilidad justo por el monto de las propinas.
// Un movimiento propina_pagada explícito es el caso contrario —ahí la salida no
// venía descontada—, así que ese sí se resta como costo.
// Los retiros de socios no son gasto: son reparto de utilidad, y van debajo de
// la línea.

/** Devuelve los últimos `n` meses calendario ('YYYY-MM'), el más antiguo primero. */
export function mesesRecientes(hasta: Date, n: number): string[] {
  const out: string[] = [];
  let anio = hasta.getUTCFullYear();
  let mes = hasta.getUTCMonth();
  for (let i = 0; i < n; i++) {
    out.unshift(`${anio}-${String(mes + 1).padStart(2, '0')}`);
    if (--mes < 0) { mes = 11; anio--; }
  }
  return out;
}

export interface MovimientoPnl {
  fecha: string; // 'YYYY-MM-DD'
  tipo: TipoMovimiento;
  monto: number;
  categoria: string | null;
  facturado: boolean;
}

/** Valor del inventario a costo en los extremos del mes (de snapshots_patrimonio). */
export interface InventarioMes {
  inicial: number | null;
  final: number | null;
  fecha_inicial: string | null;
  fecha_final: string | null;
}

export interface FilaPnl {
  mes: string;
  ventas: { efectivo: number; tarjeta: number; propinas: number; total: number };
  comision_terminal: number;
  ventas_netas: number;
  compras_inventario: number;
  variacion_inventario: number | null;
  costo_ventas: number;
  costo_ventas_metodo: 'inventario' | 'compras';
  utilidad_bruta: number;
  margen_bruto: number;
  sueldos: number;
  gastos_por_categoria: { categoria: string; monto: number }[];
  gastos_totales: number;
  propinas_pagadas: number;
  utilidad_operativa: number;
  margen_operativo: number;
  retiros_socios: number;
  facturado: { tarjeta: number; gastos: number; balance: number };
  inventario: InventarioMes | null;
  sin_movimientos: boolean;
}

const SIN_CATEGORIA = 'Sin categoría';

/**
 * Margen como fracción de las ventas, a 4 decimales. `redondear` dejaría saltos
 * de 1%, que esconden diferencias reales al comparar meses.
 */
function margen(utilidad: number, ventas: number): number {
  return ventas ? Math.round((utilidad / ventas) * 10_000) / 10_000 : 0;
}

/**
 * Arma una fila de P&L por cada mes pedido. `movs` puede traer movimientos de
 * cualquier fecha: los que caen fuera de `meses` se ignoran.
 *
 * El costo de ventas usa la variación de inventario cuando hay snapshots que
 * enmarquen el mes (compras − lo que se quedó en el almacén); si no los hay
 * —el histórico no tiene inventario valuado— cae a las compras del mes y lo
 * declara en `costo_ventas_metodo`.
 */
export function estadoResultadosMensual(
  meses: string[],
  movs: MovimientoPnl[],
  inventarioPorMes: Record<string, InventarioMes> = {},
): FilaPnl[] {
  const porMes = new Map<string, MovimientoPnl[]>(meses.map((m) => [m, []]));
  for (const m of movs) {
    const bucket = porMes.get(m.fecha.slice(0, 7));
    if (bucket) bucket.push(m);
  }

  return meses.map((mes) => {
    const delMes = porMes.get(mes)!;
    const suma = (pred: (m: MovimientoPnl) => boolean) =>
      redondear(delMes.filter(pred).reduce((a, m) => a + m.monto, 0));
    const porTipo = (tipo: TipoMovimiento) => suma((m) => m.tipo === tipo);

    const efectivo = porTipo('venta_efectivo');
    const tarjeta = porTipo('venta_tarjeta');
    const propinas = porTipo('propina_tarjeta');
    const ventasTotal = redondear(efectivo + tarjeta + propinas);
    const comision = porTipo('comision_terminal');
    const ventasNetas = redondear(ventasTotal - comision);

    const compras = porTipo('compra_inventario');
    const inv = inventarioPorMes[mes] ?? null;
    const variacion =
      inv && inv.inicial != null && inv.final != null ? redondear(inv.final - inv.inicial) : null;
    // Compras que no se consumieron se quedan en el almacén: no son costo del mes.
    const costoVentas = variacion == null ? compras : redondear(compras - variacion);
    const utilidadBruta = redondear(ventasNetas - costoVentas);

    const sueldos = porTipo('sueldo');
    const gastosMap = new Map<string, number>();
    for (const m of delMes) {
      if (m.tipo !== 'gasto') continue;
      const k = m.categoria ?? SIN_CATEGORIA;
      gastosMap.set(k, redondear((gastosMap.get(k) ?? 0) + m.monto));
    }
    const gastosPorCategoria = [...gastosMap.entries()]
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto);
    const gastosTotales = redondear(gastosPorCategoria.reduce((a, g) => a + g.monto, 0));

    // Sólo las propinas capturadas como salida explícita son costo: las del flujo
    // normal ya vienen restadas de la venta en efectivo del día.
    const propinasPagadas = porTipo('propina_pagada');
    const utilidadOperativa = redondear(utilidadBruta - sueldos - gastosTotales - propinasPagadas);

    const facturadoTarjeta = redondear(tarjeta + propinas);
    const facturadoGastos = suma((m) => m.facturado);

    return {
      mes,
      ventas: { efectivo, tarjeta, propinas, total: ventasTotal },
      comision_terminal: comision,
      ventas_netas: ventasNetas,
      compras_inventario: compras,
      variacion_inventario: variacion,
      costo_ventas: costoVentas,
      costo_ventas_metodo: variacion == null ? 'compras' : 'inventario',
      utilidad_bruta: utilidadBruta,
      margen_bruto: margen(utilidadBruta, ventasTotal),
      sueldos,
      gastos_por_categoria: gastosPorCategoria,
      gastos_totales: gastosTotales,
      propinas_pagadas: propinasPagadas,
      utilidad_operativa: utilidadOperativa,
      margen_operativo: margen(utilidadOperativa, ventasTotal),
      retiros_socios: porTipo('retiro_socio'),
      facturado: {
        tarjeta: facturadoTarjeta,
        gastos: facturadoGastos,
        balance: redondear(facturadoTarjeta - facturadoGastos),
      },
      inventario: inv,
      sin_movimientos: delMes.length === 0,
    };
  });
}

/** Columna "total del periodo": suma las filas mensuales y recalcula los márgenes. */
export function totalizarPnl(filas: FilaPnl[]): Omit<FilaPnl, 'mes' | 'inventario' | 'costo_ventas_metodo'> & { meses: number } {
  const sum = (f: (x: FilaPnl) => number) => redondear(filas.reduce((a, x) => a + f(x), 0));

  const gastosMap = new Map<string, number>();
  for (const fila of filas) {
    for (const g of fila.gastos_por_categoria) {
      gastosMap.set(g.categoria, redondear((gastosMap.get(g.categoria) ?? 0) + g.monto));
    }
  }

  const ventasTotal = sum((f) => f.ventas.total);
  const utilidadBruta = sum((f) => f.utilidad_bruta);
  const utilidadOperativa = sum((f) => f.utilidad_operativa);
  const conVariacion = filas.filter((f) => f.variacion_inventario != null);

  return {
    meses: filas.length,
    ventas: {
      efectivo: sum((f) => f.ventas.efectivo),
      tarjeta: sum((f) => f.ventas.tarjeta),
      propinas: sum((f) => f.ventas.propinas),
      total: ventasTotal,
    },
    comision_terminal: sum((f) => f.comision_terminal),
    ventas_netas: sum((f) => f.ventas_netas),
    compras_inventario: sum((f) => f.compras_inventario),
    variacion_inventario: conVariacion.length ? redondear(conVariacion.reduce((a, f) => a + f.variacion_inventario!, 0)) : null,
    costo_ventas: sum((f) => f.costo_ventas),
    utilidad_bruta: utilidadBruta,
    margen_bruto: margen(utilidadBruta, ventasTotal),
    sueldos: sum((f) => f.sueldos),
    gastos_por_categoria: [...gastosMap.entries()]
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto),
    gastos_totales: sum((f) => f.gastos_totales),
    propinas_pagadas: sum((f) => f.propinas_pagadas),
    utilidad_operativa: utilidadOperativa,
    margen_operativo: margen(utilidadOperativa, ventasTotal),
    retiros_socios: sum((f) => f.retiros_socios),
    facturado: {
      tarjeta: sum((f) => f.facturado.tarjeta),
      gastos: sum((f) => f.facturado.gastos),
      balance: sum((f) => f.facturado.balance),
    },
    sin_movimientos: filas.every((f) => f.sin_movimientos),
  };
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
