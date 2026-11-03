import { Prisma } from '@prisma/client';

/**
 * Guarda la presentación que realmente llegó en un ticket confirmado.
 * `contenido_compra = 0` representa que el ticket no informó contenido; así
 * no se confunde con la presentación canónica del catálogo.
 */
export async function registrarPresentacionesObservadas(tx: Prisma.TransactionClient, purchaseId: bigint) {
  await tx.$executeRaw`
    INSERT INTO product_presentation_variants
      (product_id, unidad_compra, contenido_compra, unidad_base, observaciones,
       costo_base_medio, primera_fecha, ultima_fecha, proveedores, es_canonica, notas)
    SELECT pl.product_id,
      COALESCE(NULLIF(trim(pl.unidad_compra), ''), 'desconocida'),
      COALESCE(pl.contenido_compra, 0), p.unidad_base, 1, pl.costo_unitario,
      h.fecha_recepcion, h.fecha_recepcion,
      COALESCE(NULLIF(trim(h.proveedor), ''), 'sin proveedor'), false,
      CASE WHEN pl.contenido_compra IS NULL THEN 'Contenido no informado en el recibo.' ELSE NULL END
    FROM purchase_lines pl
    JOIN purchases h ON h.id = pl.purchase_id
    JOIN products p ON p.id = pl.product_id
    WHERE pl.purchase_id = ${purchaseId}
    ON CONFLICT (product_id, unidad_compra, contenido_compra, unidad_base)
    DO UPDATE SET
      observaciones = product_presentation_variants.observaciones + 1,
      costo_base_medio = CASE
        WHEN product_presentation_variants.costo_base_medio IS NULL THEN EXCLUDED.costo_base_medio
        ELSE ((product_presentation_variants.costo_base_medio * product_presentation_variants.observaciones) + EXCLUDED.costo_base_medio)
          / (product_presentation_variants.observaciones + 1)
      END,
      primera_fecha = LEAST(product_presentation_variants.primera_fecha, EXCLUDED.primera_fecha),
      ultima_fecha = GREATEST(product_presentation_variants.ultima_fecha, EXCLUDED.ultima_fecha),
      proveedores = CASE
        WHEN product_presentation_variants.proveedores IS NULL OR product_presentation_variants.proveedores = '' THEN EXCLUDED.proveedores
        WHEN position(EXCLUDED.proveedores in product_presentation_variants.proveedores) > 0 THEN product_presentation_variants.proveedores
        ELSE product_presentation_variants.proveedores || ', ' || EXCLUDED.proveedores
      END;
  `;
}
