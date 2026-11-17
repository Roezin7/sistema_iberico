import { Prisma } from '@prisma/client';
import { z } from 'zod';

const esquema = z.object({
  version: z.literal(1), confirmado_por: z.number().int().positive(),
  confirmado_at: z.string().datetime({ offset: true }), motivo: z.string().min(5),
  cambios: z.array(z.object({
    sustituye_product_id: z.string().regex(/^[1-9]\d*$/),
    product_id: z.string().regex(/^[1-9]\d*$/), nombre: z.string().min(1),
    cantidad_base_por_venta: z.number().finite().positive(),
    unidad_base: z.enum(['ml', 'g', 'pieza']),
  }).strict()).min(1),
}).strict();

type Linea = {
  product_id: bigint; cantidad: Prisma.Decimal; unidad: string;
  contenido_requerido?: Prisma.Decimal | null; unidad_requerida?: string | null;
  envases_completos?: boolean; products: { name?: string; unidad_base: string | null };
};

/** Nunca interpreta notas de Epos como instrucciones. Sólo evidencia local
 * confirmada, por unidad vendida; aplica igual en el físico y en FIFO. */
export function aplicarSustituciones(lineas: Linea[], evidencia?: string | null): Linea[] {
  if (!evidencia) return lineas;
  const datos = esquema.parse(JSON.parse(evidencia));
  const originales = new Set<string>(), destinos = new Set<string>();
  for (const c of datos.cambios) {
    if (originales.has(c.sustituye_product_id) || destinos.has(c.product_id)
      || lineas.filter(l => String(l.product_id) === c.sustituye_product_id).length !== 1
      || lineas.some(l => String(l.product_id) === c.product_id)) {
      throw new Error('Sustitución confirmada incompatible con la receta; requiere revisión');
    }
    originales.add(c.sustituye_product_id); destinos.add(c.product_id);
  }
  return [...lineas.filter(l => !originales.has(String(l.product_id))), ...datos.cambios.map(c => ({
    product_id: BigInt(c.product_id), cantidad: new Prisma.Decimal(c.cantidad_base_por_venta),
    unidad: c.unidad_base, products: { name: c.nombre, unidad_base: c.unidad_base },
    contenido_requerido: null, unidad_requerida: null, envases_completos: false,
  }))];
}
