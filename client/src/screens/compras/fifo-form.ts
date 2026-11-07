import { convertirCompraABase, normalizarUnidadCompra } from '../../../../server/src/lib/unidades-compra';
export interface ProductoPresentacion {
  unidad_base?: string | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  /** Fracción utilizable de la presentación (0–1). */
  rendimiento_util?: number | null;
  presentacion_modo?: 'exacta' | 'por_lote' | 'variable' | string | null;
  presentacion_nota?: string | null;
}

export function normalizarUnidad(valor?: string | null) {
  return normalizarUnidadCompra(valor);
}

export function formatoCantidad(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(valor)) return '';
  return Number.isInteger(valor) ? String(valor) : valor.toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

function rendimientoUtil(producto?: ProductoPresentacion | null) {
  const valor = Number(producto?.rendimiento_util ?? 1);
  return Number.isFinite(valor) && valor > 0 && valor <= 1 ? valor : 1;
}

function unidadTexto(valor?: string | null) {
  return normalizarUnidad(valor) ?? valor?.trim() ?? 'unidad';
}

export function presentacionTexto(producto?: ProductoPresentacion | null) {
  if (!producto) return 'Selecciona un producto para cargar su presentación.';
  const contenido = producto.contenido_compra == null ? null : formatoCantidad(Number(producto.contenido_compra));
  if (contenido && producto.unidad_compra) {
    const rendimiento = rendimientoUtil(producto);
    const usable = Number(producto.contenido_compra) * rendimiento;
    const detalleRendimiento = rendimiento < 0.999 ? ` · rendimiento útil ${Math.round(rendimiento * 100)}%` : '';
    const modo = producto.presentacion_modo === 'por_lote' ? ' · captura el tamaño real de cada ticket' : producto.presentacion_modo === 'variable' ? ' · contenido aproximado; no se infiere' : '';
    return `${contenido} ${producto.unidad_base ?? 'unidades base'} por ${producto.unidad_compra}${detalleRendimiento} · usable: ${formatoCantidad(usable)} ${producto.unidad_base ?? 'unidades base'}${modo}`;
  }
  if (producto.unidad_base) return `Unidad base: ${producto.unidad_base}. Presentación pendiente.`;
  return 'Presentación pendiente de configurar.';
}

/** Texto explícito para el operador: qué equivale a una unidad del ticket. */
export function conversionCompraTexto(producto?: ProductoPresentacion | null) {
  if (!producto) return 'Selecciona un producto para ver su conversión.';
  const contenido = Number(producto.contenido_compra);
  const unidadCompra = producto.unidad_compra?.trim();
  const unidadBase = producto.unidad_base?.trim();
  if (!Number.isFinite(contenido) || contenido <= 0 || !unidadCompra || !unidadBase) {
    return 'Conversión pendiente: configura presentación y rendimiento en Catálogo.';
  }
  if (producto.presentacion_modo === 'por_lote') return 'Presentación por lote: captura el contenido real del ticket; no se usa el tamaño del catálogo.';
  if (producto.presentacion_modo === 'variable') return 'Presentación variable: captura cantidad base explícita; la referencia del catálogo es aproximada.';
  const usable = contenido * rendimientoUtil(producto);
  const rendimiento = rendimientoUtil(producto);
  const sufijo = rendimiento < 0.999 ? ` (${Math.round(rendimiento * 100)}% útil)` : '';
  return `1 ${unidadTexto(unidadCompra)} = ${formatoCantidad(usable)} ${unidadTexto(unidadBase)}${sufijo}`;
}

/**
 * Convierte lo que aparece en el ticket (paquetes, piezas, botellas, etc.)
 * a la unidad base que consume FIFO. El contenido de compra del catálogo ya
 * está expresado en unidad base por presentación.
 */
export function cantidadBaseDesdePresentacion(input: {
  cantidadCompra: number | null | undefined;
  unidadCompra?: string | null;
  contenidoPorPresentacion: number | null | undefined;
  unidadBase?: string | null;
  rendimientoUtil?: number | null;
}) {
  return convertirCompraABase(input);
}

export function costoBase(importe: number | null | undefined, cantidadBase: number | null | undefined) {
  const total = Number(importe);
  const cantidad = Number(cantidadBase);
  if (!Number.isFinite(total) || !Number.isFinite(cantidad) || cantidad <= 0) return null;
  return total / cantidad;
}

export function cantidadBaseCompra(linea: { cantidad_fuente: string | number | null; unidad_fuente?: string | null; unidad_compra?: string | null; contenido_compra?: string | number | null }, producto?: ProductoPresentacion) {
  if (!producto || producto.presentacion_modo === 'variable') return null;
  return cantidadBaseDesdePresentacion({ cantidadCompra: Number(linea.cantidad_fuente), unidadCompra: linea.unidad_fuente || linea.unidad_compra,
    contenidoPorPresentacion: Number(linea.contenido_compra ?? (producto.presentacion_modo === 'exacta' ? producto.contenido_compra : null)),
    unidadBase: producto.unidad_base, rendimientoUtil: producto.rendimiento_util });
}
