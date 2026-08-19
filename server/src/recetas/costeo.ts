export type UnidadBase = 'g' | 'ml' | 'pieza' | 'unidad';

export interface CosteoInsumo {
  unitCost: number | null;
  unidadBase: string | null;
  contenidoCompra: number | null;
  rendimientoUtil: number | null;
}

export interface CostoReceta {
  costoUnitarioBase: number | null;
  costoEstimado: number | null;
  cantidadBase: number | null;
  unidadBase: string | null;
  faltaConfiguracion: string[];
}

const OZ_ML = 29.5735;
const UNIDADES_VALIDAS = new Set<UnidadBase>(['g', 'ml', 'pieza', 'unidad']);

/** Convierte una cantidad de receta a la unidad base del insumo. */
export function convertirCantidad(cantidad: number, unidad: string, unidadBase: string): number | null {
  const u = unidad.trim().toLowerCase();
  const b = unidadBase.trim().toLowerCase();
  if (u === b || (u === 'unidad' && b === 'pieza') || (u === 'pieza' && b === 'unidad')) return cantidad;
  if (u === 'oz' && b === 'ml') return cantidad * OZ_ML;
  if (u === 'l' && b === 'ml') return cantidad * 1000;
  if (u === 'kg' && b === 'g') return cantidad * 1000;
  return null;
}

/**
 * Calcula el costo de una línea usando el precio del paquete y su presentación.
 * Si falta metadata, devuelve null en vez de multiplicar cantidades de ml/g
 * por el precio total del paquete (el error que esta capa corrige).
 */
export function costoLinea(cantidad: number, unidad: string, insumo: CosteoInsumo): CostoReceta {
  const faltante: string[] = [];
  const unidadBase = insumo.unidadBase?.trim().toLowerCase() || null;
  if (!unidadBase || !UNIDADES_VALIDAS.has(unidadBase as UnidadBase)) faltante.push('unidad_base');
  if (insumo.unitCost == null) faltante.push('unit_cost');
  if (insumo.contenidoCompra == null || insumo.contenidoCompra <= 0) faltante.push('contenido_compra');
  const rendimiento = insumo.rendimientoUtil ?? 1;
  if (rendimiento <= 0 || rendimiento > 1) faltante.push('rendimiento_util');
  if (faltante.length > 0 || !unidadBase || insumo.unitCost == null || insumo.contenidoCompra == null) {
    return { costoUnitarioBase: null, costoEstimado: null, cantidadBase: null, unidadBase, faltaConfiguracion: faltante };
  }
  const cantidadBase = convertirCantidad(cantidad, unidad, unidadBase);
  if (cantidadBase == null) {
    return { costoUnitarioBase: null, costoEstimado: null, cantidadBase: null, unidadBase, faltaConfiguracion: [`unidad_incompatible:${unidad}->${unidadBase}`] };
  }
  const costoUnitarioBase = insumo.unitCost / (insumo.contenidoCompra * rendimiento);
  return {
    costoUnitarioBase,
    costoEstimado: cantidadBase * costoUnitarioBase,
    cantidadBase,
    unidadBase,
    faltaConfiguracion: [],
  };
}
