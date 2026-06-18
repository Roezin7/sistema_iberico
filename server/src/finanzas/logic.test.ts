import { describe, it, expect } from 'vitest';
import {
  comisionTerminal,
  calcularSaldosTeoricos,
  descuadre,
  resumenSemana,
  capitalSocio,
  COMISION_RATE,
} from './logic.js';

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
