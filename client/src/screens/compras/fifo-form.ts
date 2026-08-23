export interface ProductoPresentacion {
  unidad_base?: string | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  /** Fracción utilizable de la presentación (0–1). */
  rendimiento_util?: number | null;
}

export function normalizarUnidad(valor?: string | null) {
  const unidad = (valor ?? '').trim().toLowerCase();
  if (!unidad) return null;
  if (/^(g|gr|gramo|gramos)$/.test(unidad)) return 'g';
  if (/^(kg|kilo|kilos)$/.test(unidad)) return 'kg';
  if (/^(ml|cc|mililitro|mililitros)$/.test(unidad)) return 'ml';
  if (/^(l|litro|litros)$/.test(unidad)) return 'l';
  if (/^(pz|pza|pzas|pieza|piezas|unidad|unidades|ud)$/.test(unidad)) return 'pieza';
  return unidad;
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
    return `${contenido} ${producto.unidad_base ?? 'unidades base'} por ${producto.unidad_compra}${detalleRendimiento} · usable: ${formatoCantidad(usable)} ${producto.unidad_base ?? 'unidades base'}`;
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
  const cantidad = Number(input.cantidadCompra);
  const contenido = Number(input.contenidoPorPresentacion);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  const rendimiento = Number(input.rendimientoUtil ?? 1);
  const factorRendimiento = Number.isFinite(rendimiento) && rendimiento > 0 && rendimiento <= 1 ? rendimiento : 1;
  if (Number.isFinite(contenido) && contenido > 0) return cantidad * contenido * factorRendimiento;

  const origen = normalizarUnidad(input.unidadCompra);
  const destino = normalizarUnidad(input.unidadBase);
  if (origen === destino) return cantidad;
  if (origen === 'kg' && destino === 'g') return cantidad * 1000;
  if (origen === 'l' && destino === 'ml') return cantidad * 1000;
  return null;
}

export function costoBase(importe: number | null | undefined, cantidadBase: number | null | undefined) {
  const total = Number(importe);
  const cantidad = Number(cantidadBase);
  if (!Number.isFinite(total) || !Number.isFinite(cantidad) || cantidad <= 0) return null;
  return total / cantidad;
}
