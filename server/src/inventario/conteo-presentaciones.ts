import { Prisma } from '@prisma/client';
import { HttpError } from '../middleware/error.js';
export interface PresentacionContada { unidades: number; contenido_base: number; unidad_base: string; etiqueta: string }
export function validarPresentacionesConteo(linea: { cantidad_base?: number; presentaciones?: PresentacionContada[] }, unidadBase: string | null | undefined) {
  if (!linea.presentaciones) return null;
  if (!linea.presentaciones.length || linea.presentaciones.length > 10 || linea.cantidad_base == null) throw new HttpError(400, 'El desglose requiere cantidad base y de 1 a 10 presentaciones');
  let total = new Prisma.Decimal(0);
  for (const p of linea.presentaciones) {
    if (!Number.isFinite(p.unidades) || p.unidades < 0 || !Number.isFinite(p.contenido_base) || p.contenido_base <= 0 || p.unidad_base !== unidadBase || !p.etiqueta.trim() || p.etiqueta.length > 180) throw new HttpError(400, 'Presentación de conteo incompatible con el producto');
    total = total.plus(new Prisma.Decimal(p.unidades).mul(p.contenido_base));
  }
  if (!new Prisma.Decimal(linea.cantidad_base).toDecimalPlaces(4).eq(total.toDecimalPlaces(4))) throw new HttpError(400, 'Las unidades y sus tamaños no coinciden con la cantidad base del conteo');
  return JSON.stringify(linea.presentaciones);
}
