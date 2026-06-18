import { api } from '../../api';

export type TipoMov =
  | 'venta_efectivo' | 'venta_tarjeta' | 'propina_tarjeta' | 'comision_terminal' | 'gasto'
  | 'sueldo' | 'compra_inventario' | 'transferencia' | 'retiro_socio' | 'deposito' | 'propina_pagada';

export interface Regla {
  requiereOrigen: boolean; requiereDestino: boolean; requiereCategoria: boolean;
  requiereSocio: boolean; facturadoDefault: boolean; autogenerado?: boolean;
}
export interface Ubicacion { id: number; nombre: string; tipo: 'banco' | 'efectivo'; socio_id: number | null }
export interface Referencias {
  ubicaciones: Ubicacion[];
  categorias: { id: number; nombre: string }[];
  socios: { id: number; nombre: string }[];
  reglas: Record<TipoMov, Regla>;
}
export interface Semana {
  id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string;
  estado: 'abierta' | 'cerrada'; cerrada_at: string | null;
}
export interface FilaCuadre {
  ubicacion_id: number; nombre: string; tipo: string;
  saldo_inicial: number; saldo_teorico: number; saldo_real: number | null; descuadre: number | null;
}
export interface Resumen {
  estado: string;
  ventas: { efectivo: number; tarjeta: number; propinas: number; total: number };
  comision_terminal_estimada: number;
  compras_inventario: number;
  utilidad: number; margen: number; utilidad_pct: number;
  facturado: { tarjeta_facturable: number; gastos_facturados: number; balance: number };
  capital_socios: { socio_id: number; nombre: string; transferencias: number; retiros: number; capital: number }[];
  saldo_inicial_total: number; saldo_real_final_total: number;
}
export interface Movimiento {
  id: number; fecha: string; tipo: TipoMov; monto: number;
  ubicacion_origen_id: number | null; ubicacion_destino_id: number | null;
  categoria_id: number | null; socio_id: number | null; facturado: boolean; descripcion: string | null;
}

export interface DiaFila {
  fecha: string; dia: string;
  venta_efectivo: number; venta_tarjeta: number; propina_tarjeta: number;
  gasto_efectivo: number; sueldos: number;
  total_ventas: number; total_egresos: number;
}
export interface ResumenDiario { estado: string; dias: DiaFila[] }

export const finanzas = {
  referencias: () => api<Referencias>('/finanzas/referencias'),
  getSaldosIniciales: () => api<{ ubicacion_id: number; monto: number }[]>('/finanzas/saldos-iniciales'),
  fijarSaldosIniciales: (saldos: { ubicacion_id: number; monto: number }[]) =>
    api('/finanzas/saldos-iniciales', { method: 'POST', body: { saldos } }),
  semanas: () => api<Semana[]>('/finanzas/semanas'),
  semanaActual: () => api<Semana | null>('/finanzas/semanas/actual'),
  crearSemana: (fecha_inicio?: string) => api<Semana>('/finanzas/semanas', { method: 'POST', body: { fecha_inicio } }),
  cuadre: (id: number) => api<{ ubicaciones: FilaCuadre[] }>(`/finanzas/semanas/${id}/cuadre`),
  resumen: (id: number) => api<Resumen>(`/finanzas/semanas/${id}/resumen`),
  movimientos: (id: number) => api<Movimiento[]>(`/finanzas/semanas/${id}/movimientos`),
  dias: (id: number) => api<ResumenDiario>(`/finanzas/semanas/${id}/dias`),
  guardarDia: (id: number, body: { fecha: string; venta_efectivo: number; venta_tarjeta: number; propina_tarjeta: number; gasto_efectivo: number; sueldos: number }) =>
    api<ResumenDiario>(`/finanzas/semanas/${id}/dias`, { method: 'PUT', body }),
  crearMovimiento: (body: Record<string, unknown>) => api('/finanzas/movimientos', { method: 'POST', body }),
  crearArqueo: (body: Record<string, unknown>) => api('/finanzas/arqueos', { method: 'POST', body }),
  cerrar: (id: number) => api<Resumen>(`/finanzas/semanas/${id}/cerrar`, { method: 'POST', body: {} }),
  reabrir: (id: number) => api<Semana>(`/finanzas/semanas/${id}/reabrir`, { method: 'POST', body: {} }),
};

export const TIPOS: { tipo: TipoMov; label: string }[] = [
  { tipo: 'venta_efectivo', label: 'Venta efectivo' },
  { tipo: 'venta_tarjeta', label: 'Venta tarjeta' },
  { tipo: 'propina_tarjeta', label: 'Propina tarjeta' },
  { tipo: 'gasto', label: 'Gasto' },
  { tipo: 'sueldo', label: 'Sueldo' },
  { tipo: 'compra_inventario', label: 'Compra inventario' },
  { tipo: 'transferencia', label: 'Transferencia' },
  { tipo: 'retiro_socio', label: 'Retiro socio' },
  { tipo: 'deposito', label: 'Depósito' },
  { tipo: 'propina_pagada', label: 'Propina pagada' },
];

export const mxn = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
