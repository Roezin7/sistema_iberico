export interface ProductoMedida {
  unidad_base?: string | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  presentacion_modo?: string;
}
export interface UnidadMedida { factor: number; unidad_captura?: string }
export interface SaldoMedida { qty_captura: number; factor: number; cantidad_base?: number }

/** Una sola regla para etiqueta, precarga, expectativa y envío del conteo.
 * El factor del saldo guardado interpreta ese saldo; el catálogo únicamente
 * decide en qué unidad presentarlo ahora. Nunca cruzar ambos factores. */
export function medidaConteo(p: ProductoMedida, u?: UnidadMedida) {
  const base = p.unidad_base;
  if (base === 'pieza') return { unidad: 'pieza', factor: 1 };
  if ((base === 'g' || base === 'ml') && p.presentacion_modo === 'variable') return { unidad: base, factor: 1 };
  if ((base === 'g' || base === 'ml') && p.presentacion_modo === 'por_lote') return { unidad: base === 'g' ? 'kg' : 'litro', factor: 1000 };
  const contenido = Number(p.contenido_compra);
  if (contenido > 0 && Number.isFinite(contenido)) {
    const texto = (p.unidad_compra || u?.unidad_captura || base || 'unidad').trim().toLowerCase();
    // Una descripción como "2 piezas" no identifica una unidad individual.
    // No inventar el peso de una pieza: pedir directamente el peso/volumen.
    if (/^\d/.test(texto) && (base === 'g' || base === 'ml')) return { unidad: base, factor: 1 };
    return { unidad: texto.split(/\s|\(|\//)[0] || 'unidad', factor: contenido };
  }
  const factor = u?.factor;
  return { unidad: u?.unidad_captura || base || 'unidad', factor: factor != null && Number.isFinite(factor) && factor > 0 ? factor : 1 };
}

export function cantidadEnConteo(base: number, p: ProductoMedida, u?: UnidadMedida) {
  return Number((base / medidaConteo(p, u).factor).toPrecision(15));
}
export function cantidadDesdeSaldo(saldo: SaldoMedida, p: ProductoMedida, u?: UnidadMedida) {
  const base = saldo.cantidad_base ?? saldo.qty_captura * saldo.factor;
  return cantidadEnConteo(base, p, u);
}
export function cantidadBaseConteo(cantidad: number, p: ProductoMedida, u?: UnidadMedida) {
  return Number((cantidad * medidaConteo(p, u).factor).toPrecision(15));
}
