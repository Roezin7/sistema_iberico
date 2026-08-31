import { describe, it, expect } from 'vitest';
import {
  comisionTerminal,
  calcularSaldosTeoricos,
  descuadre,
  resumenSemana,
  capitalSocio,
  COMISION_RATE,
  mesesRecientes,
  estadoResultadosMensual,
  totalizarPnl,
  costoVentasPorInventario,
  seleccionarValorPatrimonio,
  type MovimientoPnl,
} from './logic.js';

describe('seleccionarValorPatrimonio', () => {
  it('prefiere el cierre físico de la semana', () => {
    expect(seleccionarValorPatrimonio(35237.42, 36100)).toEqual({ valor: 35237.42, fuente: 'inventario_fisico_cierre' });
  });
  it('usa el conteo físico actual sólo como provisional', () => {
    expect(seleccionarValorPatrimonio(null, 36100)).toEqual({ valor: 36100, fuente: 'inventario_fisico_actual' });
  });
  it('deja patrimonio pendiente sin conteo físico', () => {
    expect(seleccionarValorPatrimonio(null, null)).toEqual({ valor: null, fuente: 'pendiente_cierre' });
  });
});

describe('costoVentasPorInventario', () => {
  it('usa apertura + compras − cierre', () => {
    expect(costoVentasPorInventario(10000, 2500, 8000)).toBe(4500);
  });

  it('no inventa costo si falta un extremo', () => {
    expect(costoVentasPorInventario(null, 2500, 8000)).toBeNull();
    expect(costoVentasPorInventario(10000, 2500, null)).toBeNull();
  });
});

describe('comisionTerminal', () => {
  it('1.99% sobre (ventas_tarjeta + propinas_tarjeta)', () => {
    expect(comisionTerminal(10000, 500)).toBe(208.95); // 10500 * 0.0199
  });
  it('cero si no hay tarjeta', () => {
    expect(comisionTerminal(0, 0)).toBe(0);
  });
  it('la tasa es 1.99%', () => {
    expect(COMISION_RATE).toBe(0.0199);
  });
});

describe('calcularSaldosTeoricos', () => {
  // ubicaciones: 1=Banco, 2=Caja, 3=Caja Fuerte Arturo
  it('venta efectivo entra a Caja, venta tarjeta a Banco', () => {
    const s = calcularSaldosTeoricos(
      { 1: 0, 2: 0, 3: 0 },
      [
        { ubicacion_origen_id: null, ubicacion_destino_id: 2, monto: 5000 }, // venta efectivo
        { ubicacion_origen_id: null, ubicacion_destino_id: 1, monto: 8000 }, // venta tarjeta
      ],
    );
    expect(s[2]).toBe(5000);
    expect(s[1]).toBe(8000);
  });

  it('transferencia Caja -> Caja Fuerte: resta de Caja, suma a caja fuerte (capital neutral)', () => {
    const s = calcularSaldosTeoricos(
      { 1: 0, 2: 5000, 3: 0 },
      [{ ubicacion_origen_id: 2, ubicacion_destino_id: 3, monto: 2000 }],
    );
    expect(s[2]).toBe(3000);
    expect(s[3]).toBe(2000);
  });

  it('gasto efectivo y comisión banco restan de su ubicación', () => {
    const s = calcularSaldosTeoricos(
      { 1: 8000, 2: 5000 },
      [
        { ubicacion_origen_id: 2, ubicacion_destino_id: null, monto: 1200 }, // gasto efectivo
        { ubicacion_origen_id: 1, ubicacion_destino_id: null, monto: 159.2 }, // comisión
      ],
    );
    expect(s[2]).toBe(3800);
    expect(s[1]).toBe(7840.8);
  });

  it('parte del saldo inicial (no editable) y encadena', () => {
    const s = calcularSaldosTeoricos({ 2: 1500 }, [
      { ubicacion_origen_id: null, ubicacion_destino_id: 2, monto: 500 },
    ]);
    expect(s[2]).toBe(2000);
  });
});

describe('descuadre', () => {
  it('faltante (real < teórico) => negativo', () => {
    expect(descuadre(3800, 4000)).toBe(-200);
  });
  it('sobrante (real > teórico) => positivo', () => {
    expect(descuadre(4100, 4000)).toBe(100);
  });
  it('cuadrado => 0', () => {
    expect(descuadre(4000, 4000)).toBe(0);
  });
});

describe('resumenSemana', () => {
  const base = {
    saldoInicialTotal: 10000,
    saldoRealFinalTotal: 18000,
    ventaEfectivo: 12000,
    ventaTarjeta: 8000,
    propinaTarjeta: 500,
    comprasInventario: 6000,
    gastosFacturados: 3000,
  };

  it('utilidad = saldo_real_final − saldo_inicial', () => {
    expect(resumenSemana(base).utilidad).toBe(8000);
  });
  it('ventas totales = efectivo + tarjeta + propinas', () => {
    expect(resumenSemana(base).ventasTotales).toBe(20500);
  });
  it('margen = utilidad / ventas', () => {
    expect(resumenSemana(base).margen).toBe(0.39); // 8000/20500 ≈ 0.3902
  });
  it('utilidad% = utilidad / compras_inventario', () => {
    expect(resumenSemana(base).utilidadPct).toBe(1.33); // 8000/6000
  });
  it('facturado: tarjeta_facturable y (+/-)', () => {
    const r = resumenSemana(base);
    expect(r.tarjetaFacturable).toBe(8500); // 8000 + 500
    expect(r.balanceFacturado).toBe(5500); // 8500 − 3000
  });
  it('sin ventas, margen 0 (no divide por cero)', () => {
    expect(resumenSemana({ ...base, ventaEfectivo: 0, ventaTarjeta: 0, propinaTarjeta: 0 }).margen).toBe(0);
  });
});

describe('capitalSocio', () => {
  it('transferencias a su caja fuerte − sus retiros', () => {
    expect(capitalSocio(5000, 2000)).toBe(3000);
  });
  it('solo el retiro reduce: sin retiros = total transferido', () => {
    expect(capitalSocio(5000, 0)).toBe(5000);
  });
});

// --- Casos de borde adicionales (P2.8) ---
describe('comisionTerminal — redondeo', () => {
  it('redondea a 2 decimales', () => {
    // 1234.56 * 0.0199 = 24.567744 -> 24.57
    expect(comisionTerminal(1234.56, 0)).toBe(24.57);
  });
  it('suma tarjeta + propina antes de aplicar la tasa', () => {
    expect(comisionTerminal(1000, 1000)).toBe(39.8); // 2000 * 0.0199
  });
});

describe('calcularSaldosTeoricos — retiro y depósito', () => {
  it('retiro de socio resta de la caja fuerte de origen', () => {
    const r = calcularSaldosTeoricos({ 3: 5000 }, [{ ubicacion_origen_id: 3, ubicacion_destino_id: null, monto: 1200 }]);
    expect(r[3]).toBe(3800);
  });
  it('depósito suma al banco destino', () => {
    const r = calcularSaldosTeoricos({ 1: 0 }, [{ ubicacion_origen_id: null, ubicacion_destino_id: 1, monto: 2500 }]);
    expect(r[1]).toBe(2500);
  });
  it('no muta el objeto de saldos iniciales', () => {
    const iniciales = { 1: 100 };
    calcularSaldosTeoricos(iniciales, [{ ubicacion_origen_id: null, ubicacion_destino_id: 1, monto: 50 }]);
    expect(iniciales[1]).toBe(100);
  });
});

describe('capitalSocio — retiros mayores que aportes', () => {
  it('puede quedar negativo si el socio retiró más de lo que aportó', () => {
    expect(capitalSocio(1000, 1500)).toBe(-500);
  });
});

describe('descuadre — redondeo de centavos', () => {
  it('evita ruido de punto flotante', () => {
    expect(descuadre(0.3, 0.1)).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
//  Estado de resultados (P&L)
// ---------------------------------------------------------------------------

describe('mesesRecientes', () => {
  it('devuelve los últimos N meses del más antiguo al más reciente', () => {
    expect(mesesRecientes(new Date('2026-03-15T00:00:00Z'), 4)).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03',
    ]);
  });
  it('cruza el cambio de año hacia atrás', () => {
    expect(mesesRecientes(new Date('2026-01-05T00:00:00Z'), 2)).toEqual(['2025-12', '2026-01']);
  });
});

const mov = (o: Partial<MovimientoPnl> & Pick<MovimientoPnl, 'fecha' | 'tipo' | 'monto'>): MovimientoPnl => ({
  categoria: null, facturado: false, ...o,
});

describe('estadoResultadosMensual', () => {
  it('prioriza el costo FIFO activo cuando el reporte lo recibe', () => {
    const [fila] = estadoResultadosMensual(
      ['2026-02'],
      [{ fecha: '2026-02-10', tipo: 'venta_efectivo', monto: 1000, categoria: null, facturado: false }],
      {},
      { '2026-02': 275 },
    );
    expect(fila!.costo_ventas).toBe(275);
    expect(fila!.costo_ventas_metodo).toBe('fifo');
  });
  const movs: MovimientoPnl[] = [
    mov({ fecha: '2026-02-03', tipo: 'venta_efectivo', monto: 6000 }),
    mov({ fecha: '2026-02-04', tipo: 'venta_tarjeta', monto: 4000 }),
    mov({ fecha: '2026-02-04', tipo: 'propina_tarjeta', monto: 500 }),
    mov({ fecha: '2026-02-28', tipo: 'propina_pagada', monto: 400 }),
    mov({ fecha: '2026-02-28', tipo: 'comision_terminal', monto: 89.55 }),
    mov({ fecha: '2026-02-10', tipo: 'compra_inventario', monto: 3000, facturado: true }),
    mov({ fecha: '2026-02-15', tipo: 'sueldo', monto: 1200 }),
    mov({ fecha: '2026-02-16', tipo: 'gasto', monto: 700, categoria: 'Renta' }),
    mov({ fecha: '2026-02-17', tipo: 'gasto', monto: 300, categoria: 'Servicios' }),
    mov({ fecha: '2026-02-18', tipo: 'gasto', monto: 100, categoria: 'Renta' }),
    // No entran al resultado: internos, financiamiento y reparto de utilidad.
    mov({ fecha: '2026-02-20', tipo: 'transferencia', monto: 9999 }),
    mov({ fecha: '2026-02-21', tipo: 'deposito', monto: 8888 }),
    mov({ fecha: '2026-02-22', tipo: 'retiro_socio', monto: 2000 }),
    // Otro mes: no debe contaminar febrero.
    mov({ fecha: '2026-01-31', tipo: 'venta_efectivo', monto: 50000 }),
  ];

  it('excluye transferencias, depósitos y retiros del resultado', () => {
    const [feb] = estadoResultadosMensual(['2026-02'], movs);
    expect(feb!.ventas.total).toBe(10500);
    expect(feb!.gastos_totales).toBe(1100);
    expect(feb!.retiros_socios).toBe(2000); // informativo, debajo de la línea
    // ventas_netas 10410.45 − compras 3000 − sueldos 1200 − gastos 1100 − propinas pagadas 400
    expect(feb!.utilidad_operativa).toBe(4710.45);
  });

  it('incluye las propinas en ventas: su salida ya está restada del efectivo', () => {
    const soloPropina = [mov({ fecha: '2026-02-01', tipo: 'propina_tarjeta', monto: 500 })];
    const [feb] = estadoResultadosMensual(['2026-02'], soloPropina);
    expect(feb!.ventas).toEqual({ efectivo: 0, tarjeta: 0, propinas: 500, total: 500 });
    // No hay salida capturada, así que no resta: es un lavado, no una pérdida.
    expect(feb!.propinas_pagadas).toBe(0);
    expect(feb!.utilidad_operativa).toBe(500);
  });

  it('una propina_pagada explícita sí resta, porque esa salida no venía descontada', () => {
    const [feb] = estadoResultadosMensual(['2026-02'], movs);
    expect(feb!.propinas_pagadas).toBe(400);
    const sinPago = estadoResultadosMensual(['2026-02'], movs.filter((m) => m.tipo !== 'propina_pagada'));
    expect(sinPago[0]!.utilidad_operativa).toBe(5110.45); // 400 más
  });

  it('agrupa gastos por categoría, sumando repetidas y de mayor a menor', () => {
    const [feb] = estadoResultadosMensual(['2026-02'], movs);
    expect(feb!.gastos_por_categoria).toEqual([
      { categoria: 'Renta', monto: 800 },
      { categoria: 'Servicios', monto: 300 },
    ]);
  });

  it('sin snapshots de inventario el costo de ventas son las compras', () => {
    const [feb] = estadoResultadosMensual(['2026-02'], movs);
    expect(feb!.costo_ventas_metodo).toBe('compras');
    expect(feb!.costo_ventas).toBe(3000);
    expect(feb!.variacion_inventario).toBeNull();
  });

  it('con inventario valuado descuenta lo que se quedó en el almacén', () => {
    const inv = { '2026-02': { inicial: 20000, final: 21000, fecha_inicial: '2026-01-25', fecha_final: '2026-02-22' } };
    const [feb] = estadoResultadosMensual(['2026-02'], movs, inv);
    expect(feb!.costo_ventas_metodo).toBe('inventario');
    expect(feb!.variacion_inventario).toBe(1000);
    expect(feb!.costo_ventas).toBe(2000); // 3000 comprados − 1000 que no se consumió
    expect(feb!.utilidad_bruta).toBe(8410.45); // ventas_netas 10410.45 − costo 2000
  });

  it('ignora el inventario si falta uno de los dos extremos', () => {
    const inv = { '2026-02': { inicial: null, final: 21000, fecha_inicial: null, fecha_final: '2026-02-22' } };
    const [feb] = estadoResultadosMensual(['2026-02'], movs, inv);
    expect(feb!.costo_ventas_metodo).toBe('compras');
    expect(feb!.costo_ventas).toBe(3000);
  });

  it('marca los meses sin movimientos y no divide entre cero', () => {
    const [mar] = estadoResultadosMensual(['2026-03'], movs);
    expect(mar!.sin_movimientos).toBe(true);
    expect(mar!.margen_bruto).toBe(0);
    expect(mar!.margen_operativo).toBe(0);
  });

  it('devuelve una fila por mes pedido, en orden, sin mezclar meses', () => {
    const filas = estadoResultadosMensual(['2026-01', '2026-02'], movs);
    expect(filas.map((f) => f.mes)).toEqual(['2026-01', '2026-02']);
    expect(filas[0]!.ventas.total).toBe(50000);
    expect(filas[1]!.ventas.total).toBe(10500);
  });

  it('el balance facturado incluye las propinas cobradas por terminal', () => {
    const [feb] = estadoResultadosMensual(['2026-02'], movs);
    expect(feb!.facturado.tarjeta).toBe(4500); // 4000 tarjeta + 500 propinas
    expect(feb!.facturado.gastos).toBe(3000);
    expect(feb!.facturado.balance).toBe(1500);
  });
});

describe('totalizarPnl', () => {
  const movs: MovimientoPnl[] = [
    mov({ fecha: '2026-01-10', tipo: 'venta_efectivo', monto: 1000 }),
    mov({ fecha: '2026-01-11', tipo: 'gasto', monto: 100, categoria: 'Renta' }),
    mov({ fecha: '2026-02-10', tipo: 'venta_efectivo', monto: 3000 }),
    mov({ fecha: '2026-02-11', tipo: 'gasto', monto: 200, categoria: 'Renta' }),
    mov({ fecha: '2026-02-12', tipo: 'gasto', monto: 50, categoria: 'Otros' }),
  ];
  const filas = estadoResultadosMensual(['2026-01', '2026-02'], movs);

  it('suma los meses y consolida las categorías de gasto', () => {
    const t = totalizarPnl(filas);
    expect(t.meses).toBe(2);
    expect(t.ventas.total).toBe(4000);
    expect(t.gastos_por_categoria).toEqual([
      { categoria: 'Renta', monto: 300 },
      { categoria: 'Otros', monto: 50 },
    ]);
    expect(t.gastos_totales).toBe(350);
  });

  it('recalcula el margen sobre el total, no promedia los márgenes mensuales', () => {
    const t = totalizarPnl(filas);
    // Margen del periodo = 3650/4000; promediar 0.9 y 0.9167 daría otro número.
    expect(t.margen_operativo).toBe(0.9125);
    expect(t.utilidad_operativa).toBe(3650);
  });
});
