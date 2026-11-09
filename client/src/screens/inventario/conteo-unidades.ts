export interface ProductoMedida {
  unidad_base?: string | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  presentacion_modo?: string;
  presentaciones_observadas?: { unidad_compra: string; contenido_compra: number; observaciones: number; ultima_fecha?: string | null }[];
  formatos_envase?: { contenido: number; unidad: string; fecha: string }[];
}
export interface UnidadMedida { factor: number; unidad_captura?: string }
export interface SaldoMedida { qty_captura: number; factor: number; cantidad_base?: number }
export interface FormatoConteo { id: string; unidad: string; factor: number; etiqueta: string; referencia: boolean }
const numero = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 4 });
export function textoContenido(n: number, base?: string | null) {
  return base === 'ml' && n >= 1000 ? numero(n / 1000) + ' L'
    : base === 'g' && n >= 1000 ? numero(n / 1000) + ' kg'
    : numero(n) + ' ' + (base === 'pieza' ? 'piezas' : base || 'unidades base');
}
function nombreEnvase(texto?: string | null) {
  return (texto || '').trim().match(/^(botella|lata|envase|frasco|bote|bolsa|pack|paquete|bloque|garraf[oó]n|porci[oó]n|pieza|manojo|lote|caja)/i)?.[1]?.toLowerCase() || 'unidad';
}
/** Unidades físicas documentadas, no un tamaño universal para mezcladores.
 * Los formatos de peso/volumen sin envase quedan como referencia explícita. */
export function formatosConteo(p: ProductoMedida, u?: UnidadMedida): FormatoConteo[] {
  const base = p.unidad_base, formatos: FormatoConteo[] = [];
  const add = (unidad: string, factor: number, etiqueta: string, referencia = false) => {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const id = factor + ':' + etiqueta;
    if (!formatos.some(f => f.factor === factor && f.unidad === unidad && f.etiqueta === etiqueta)) formatos.push({ id, unidad, factor, etiqueta, referencia });
  };
  const contenido = Number(p.contenido_compra), unidad = nombreEnvase(p.unidad_compra || u?.unidad_captura);
  const catalogo = () => {
    if (base === 'pieza') {
      add('pieza', 1, /\b\d+\s*(ml|g)\b/i.test(p.unidad_compra || '') ? p.unidad_compra! : 'pieza individual');
    } else if (contenido > 0) {
      const ref = unidad === 'unidad' || p.presentacion_modo === 'variable' || (base === 'g' && unidad === 'pieza');
      add(unidad, contenido, (ref ? 'Unidad de referencia' : unidad) + ' · ' + textoContenido(contenido, base) + (p.presentacion_modo === 'variable' ? ' aprox.' : ''), ref);
    }
  };
  if (p.presentacion_modo === 'exacta' && base !== 'pieza') catalogo();
  for (const f of p.formatos_envase || []) {
    if (f.unidad === base) add(unidad === 'unidad' ? 'envase' : unidad, f.contenido, (unidad === 'unidad' ? 'envase' : unidad) + ' · ' + textoContenido(f.contenido, base));
    else if (base === 'pieza' && ['ml','g'].includes(f.unidad)) add('pieza', 1, 'pieza · ' + textoContenido(f.contenido, f.unidad));
  }
  if (base === 'pieza') catalogo();
  for (const f of [...(p.presentaciones_observadas || [])].sort((a,b) => (b.ultima_fecha || '').localeCompare(a.ultima_fecha || ''))) {
    const unit = nombreEnvase(f.unidad_compra);
    if (!(f.observaciones > 0) || unit === 'unidad' || !(f.contenido_compra > 0)) continue;
    // Las observaciones antiguas no incluyen la dimensión del contenido.
    // "botella, 750" puede ser ml, nunca prueba de 750 piezas. Sólo los
    // empaques explícitos con conteo entero permiten agrupar piezas aquí.
    if (base === 'pieza' && (!['caja', 'pack', 'paquete'].includes(unit) || !Number.isInteger(f.contenido_compra))) continue;
    add(unit, f.contenido_compra, unit + ' · ' + textoContenido(f.contenido_compra, base));
  }
  catalogo();
  if (!formatos.length) add('unidad', u?.factor || 1, 'Unidad de referencia · ' + textoContenido(u?.factor || 1, base), true);
  return formatos;
}

/** Una sola regla para etiqueta, precarga, expectativa y envío del conteo.
 * El factor del saldo guardado interpreta ese saldo; el catálogo únicamente
 * decide en qué unidad presentarlo ahora. Nunca cruzar ambos factores. */
export function medidaConteo(p: ProductoMedida, u?: UnidadMedida) {
  return formatosConteo(p, u)[0];
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
