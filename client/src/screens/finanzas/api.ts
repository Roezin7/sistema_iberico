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
  flujo_caja_neto: number;
  patrimonio_activos: number;
  pasivos_activos: number;
  patrimonio_neto: number;
  utilidad: number; margen: number; utilidad_pct: number;
  ventas_operativas: number | null;
  utilidad_bruta: number | null;
  resultado_operativo: number | null;
  diferencia_fisica_valor: number | null;
  facturado: { tarjeta_facturable: number; gastos_facturados: number; balance: number };
  capital_socios: { socio_id: number; nombre: string; transferencias: number; retiros: number; capital: number }[];
  saldo_inicial_total: number; saldo_real_final_total: number;
  inventario: {
    apertura_snapshot_id: number | null; cierre_snapshot_id: number | null;
    apertura_valor: number | null; compras: number; cierre_valor: number | null;
    costo_ventas: number | null; costo_ventas_fuente: 'ledger_fifo_en_vivo' | 'pendiente_fifo';
    valor_fifo_corte: number; unidades_fifo_corte: number;
    control_fifo: {
      costo_movimientos_activos: number | null; costo_reversiones_historial: number;
      costo_normal: number; costo_excepcion: number; filas_normal: number; filas_excepcion: number;
      filas_movimientos_activos: number; filas_reversiones_historial: number;
      ventas_epos_con_consumo_activo: number; ventas_epos_con_consumo_exception: number; diferencia_costo_vs_epos: number | null;
      reporte_independiente: boolean; alerta_independencia: string | null;
    };
    estado: 'pendiente_cierre' | 'cerrado'; apertura_origen: string | null;
  };
  conciliacion_inventario: {
    estado: 'pendiente_cierre' | 'calculada';
    apertura_snapshot_id: number | null; cierre_snapshot_id: number | null;
    total_diferencia_valor: number | null; productos_con_incidencia: number;
    consumo_fifo_activo_filas: number; reversiones_historial_filas: number;
    productos_con_diferencia_consumo: number; reporte_independiente: boolean;
    alerta_independencia: string | null;
    filas: {
      product_id: number; producto: string; unidad_base: string | null;
      inventario_inicial: number; compras_recibidas: number; ajustes_inventario: number; consumo_teorico: number;
      consumo_fifo_activo: number;
      consumo_fisico_inferido: number; diferencia_consumo: number;
      existencia_fifo_esperada: number; inventario_fisico_final: number;
      diferencia_cantidad: number; costo_fifo: number | null;
      diferencia_valor: number | null;
      incidencia_tipo: 'conversion' | 'compra_faltante' | 'receta' | 'captura' | 'posible_merma' | 'sin_diferencia';
      incidencia: string;
    }[];
  };
}
export interface Movimiento {
  id: number; fecha: string; tipo: TipoMov; monto: number;
  ubicacion_origen_id: number | null; ubicacion_destino_id: number | null;
  categoria_id: number | null; socio_id: number | null; facturado: boolean; descripcion: string | null;
  compra_id: number | null;
}

export interface DiaFila {
  fecha: string; dia: string;
  venta_efectivo: number; venta_tarjeta: number; propina_tarjeta: number;
  gasto_efectivo: number; gasto_itemizado: number; compra_inventario: number; sueldos: number;
  total_ventas: number; total_egresos: number;
}
export interface ResumenDiario { estado: string; dias: DiaFila[] }

export interface EposCorteDiario {
  periodo: { from: string; to: string };
  daily_sales: { ventas: number; descuentos: number; devoluciones: number };
  bookkeeping: { ventas: number; metodos_pago: { metodo: string; total: number }[] };
  diferencias: { ventas: number; unidades: number | null; transacciones: number | null };
  filas_persistidas: number;
  filas_duplicadas: number;
  importacion_id?: number;
}

export interface EposVenta {
  id: number; fecha: string; producto: string; cantidad: number;
  venta_bruta: number; venta_neta: number | null; descuento: number;
  metodo_pago: string; costo_fifo: number | null;
  costeo_estado: string; costeo_error: string | null;
}

export interface CosteoVentaPreview {
  venta_id: number;
  producto: string;
  estado: 'costeable' | 'excepcion' | 'pendiente' | 'ya_costeada' | string;
  costo_fifo: number;
  error: string | null;
}

export interface CosteoVentasPreview {
  periodo: { from: string; to: string };
  confirmar: false;
  ventas: number;
  costeadas: number;
  excepciones: number;
  pendientes: number;
  ya_costeadas: number;
  costo_fifo: number;
  detalle: CosteoVentaPreview[];
}

export interface ConciliacionDiaria {
  id: number; fecha: string; estado: string;
  epos: { ventas: number; efectivo: number; tarjeta: number; otros: number };
  confirmado: { ventas: number; efectivo: number; tarjeta: number; otros: number };
  cuentas_abiertas: number; excepciones: unknown[]; notas: string | null;
  usuario_id: number | null; confirmado_at: string | null;
  diferencia: { ventas: number; efectivo: number; tarjeta: number; otros: number; total: number; reconciliada: boolean };
}

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
  correccionesReferencias: (semanaId: number) => api<CorreccionReferencias>(`/finanzas/semanas/${semanaId}/inventario-correcciones/referencias`),
  correcciones: (semanaId: number) => api<CorreccionInventario[]>(`/finanzas/semanas/${semanaId}/inventario-correcciones`),
  crearCorreccion: (semanaId: number, body: Record<string, unknown>) => api(`/finanzas/semanas/${semanaId}/inventario-correcciones`, { method: 'POST', body }),
  movimientos: (id: number) => api<Movimiento[]>(`/finanzas/semanas/${id}/movimientos`),
  dias: (id: number) => api<ResumenDiario>(`/finanzas/semanas/${id}/dias`),
  guardarDia: (id: number, body: { fecha: string; venta_efectivo: number; venta_tarjeta: number; propina_tarjeta: number; gasto_efectivo: number; sueldos: number }) =>
    api<ResumenDiario>(`/finanzas/semanas/${id}/dias`, { method: 'PUT', body }),
  crearMovimiento: (body: Record<string, unknown>) => api('/finanzas/movimientos', { method: 'POST', body }),
  editarMovimiento: (id: number, body: Record<string, unknown>) => api(`/finanzas/movimientos/${id}`, { method: 'PATCH', body }),
  obtenerCompra: (id: number) => api<CompraDetalle>(`/inventario/compras/${id}`),
  editarCompra: (id: number, body: Record<string, unknown>) => api(`/inventario/compras/${id}`, { method: 'PATCH', body }),
  borrarMovimiento: (id: number) => api(`/finanzas/movimientos/${id}`, { method: 'DELETE' }),
  crearArqueo: (body: Record<string, unknown>) => api('/finanzas/arqueos', { method: 'POST', body }),
  cerrar: (id: number, opciones?: { confirmar_excepciones?: boolean }) =>
    api<Resumen>(`/finanzas/semanas/${id}/cerrar`, { method: 'POST', body: opciones ?? {} }),
  reabrir: (id: number) => api<Semana>(`/finanzas/semanas/${id}/reabrir`, { method: 'POST', body: {} }),
};

export interface CorreccionReferencias {
  zonas: { id: number; nombre: string }[];
  productos: { id: number; nombre: string; unidad_base: string | null; costo: number | null; unidades: { zona_id: number; unidad_captura: string; factor: number }[] }[];
}
export interface CorreccionInventario {
  id: number; product_id: number; producto: string; unidad_base: string | null; unidad_captura: string; zona_id: number; zona: string;
  cantidad_base: number; cantidad_captura: number; factor: number; costo_unitario: number; motivo: string; nota: string | null;
  usuario: string; creado_at: string; snapshot_anterior_id: number; snapshot_nuevo_id: number;
}

export interface CompraDetalleLinea {
  id: number | null; product_id: number | null; producto: string | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente';
  descripcion_fuente: string; cantidad_fuente?: number | null; unidad_fuente?: string | null; cantidad_base: number | null; unidad_compra: string | null; contenido_compra: number | null;
  costo_unitario: number | null; importe: number; confianza: number | null; notas: string | null;
}
export interface CompraDetalle {
  id: number; fecha_recepcion: string; proveedor: string | null; ticket_ref: string | null; total: number; estado: string;
  origen_pago_id: number | null; origen_pago: string | null; lineas: CompraDetalleLinea[];
}

export const epos = {
  syncDaily: (fecha: string) => api<EposCorteDiario>('/epos/sync-daily', { method: 'POST', body: { fecha } }),
  ventas: (from: string, to: string) => api<EposVenta[]>(`/epos/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  costeoPreview: (from: string, to: string) => api<CosteoVentasPreview>('/inventario/consumo-epos', { method: 'POST', body: { from, to, confirmar: false } }),
  conciliaciones: (semanaId: number) => api<ConciliacionDiaria[]>(`/epos/conciliaciones-diarias?semana_id=${semanaId}`),
  confirmarConciliacion: (body: {
    semana_id: number; fecha: string;
    epos: { ventas: number; efectivo: number; tarjeta: number; otros: number };
    confirmado: { ventas: number; efectivo: number; tarjeta: number; otros: number };
    cuentas_abiertas: number; excepciones: Record<string, unknown>[]; notas?: string;
  }) => api<ConciliacionDiaria>('/epos/conciliaciones-diarias', { method: 'POST', body }),
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
