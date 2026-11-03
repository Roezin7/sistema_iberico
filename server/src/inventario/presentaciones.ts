import { Prisma } from '@prisma/client';

/**
 * Guarda la presentación que realmente llegó en un ticket confirmado.
 * `contenido_compra = 0` representa que el ticket no informó contenido; así
 * no se confunde con la presentación canónica del catálogo.
 */
export async function registrarPresentacionesObservadas(tx: Prisma.TransactionClient, purchaseId: bigint) {
  const compra = await tx.purchases.findUniqueOrThrow({ where: { id: purchaseId }, select: { negocio_id: true } });
  const negocio = compra.negocio_id;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`presentaciones:${negocio}`}, 0))`;
  await tx.$executeRaw`UPDATE product_presentation_variants v SET observaciones = 0 FROM products p WHERE p.id = v.product_id AND p.negocio_id = ${negocio}`;
  await tx.$executeRaw`
    WITH fuente AS (
      SELECT cl.product_id, cl.unidad_compra, cl.contenido_compra, cl.cantidad_base AS qty,
        cl.importe, h.fecha_recepcion, h.proveedor
      FROM purchase_capture_lines cl JOIN purchases h ON h.id = cl.purchase_id
      WHERE h.negocio_id = ${negocio} AND h.estado = 'confirmada'
        AND cl.tipo_linea = 'inventario' AND cl.product_id IS NOT NULL AND cl.cantidad_base > 0
      UNION ALL
      SELECT pl.product_id, pl.unidad_compra, pl.contenido_compra, pl.qty,
        COALESCE(pl.importe, pl.qty * pl.costo_unitario), h.fecha_recepcion, h.proveedor
      FROM purchase_lines pl JOIN purchases h ON h.id = pl.purchase_id
      WHERE h.negocio_id = ${negocio} AND h.estado = 'confirmada' AND pl.qty > 0
        AND NOT EXISTS (SELECT 1 FROM purchase_capture_lines cl
          WHERE cl.purchase_id = h.id AND cl.product_id = pl.product_id AND cl.tipo_linea = 'inventario')
    )
    INSERT INTO product_presentation_variants
      (product_id, unidad_compra, contenido_compra, unidad_base, observaciones,
       costo_base_medio, primera_fecha, ultima_fecha, proveedores, es_canonica, notas)
    SELECT f.product_id, COALESCE(NULLIF(trim(f.unidad_compra), ''), 'desconocida'),
      COALESCE(f.contenido_compra, 0), p.unidad_base, count(*)::int,
      sum(f.importe) / sum(f.qty), min(f.fecha_recepcion), max(f.fecha_recepcion),
      string_agg(DISTINCT COALESCE(NULLIF(trim(f.proveedor), ''), 'sin proveedor'), ', '),
      COALESCE(bool_and(p.presentacion_modo = 'exacta' AND f.unidad_compra = p.unidad_compra AND f.contenido_compra = p.contenido_compra), false),
      CASE WHEN COALESCE(f.contenido_compra, 0) = 0 THEN 'Contenido no informado en el recibo.' ELSE NULL END
    FROM fuente f JOIN products p ON p.id = f.product_id AND p.negocio_id = ${negocio}
    GROUP BY f.product_id, COALESCE(NULLIF(trim(f.unidad_compra), ''), 'desconocida'), COALESCE(f.contenido_compra, 0), p.unidad_base
    ON CONFLICT (product_id, unidad_compra, contenido_compra, unidad_base)
    DO UPDATE SET
      observaciones = EXCLUDED.observaciones, costo_base_medio = EXCLUDED.costo_base_medio,
      primera_fecha = EXCLUDED.primera_fecha, ultima_fecha = EXCLUDED.ultima_fecha,
      proveedores = EXCLUDED.proveedores, es_canonica = EXCLUDED.es_canonica;
  `;
}

/** El tamaño comercial es independiente de la unidad base: Coca puede
 * consumirse por pieza y aun exigir una botella de 450 ml, no una de 2 L. */
export function loteElegibleParaReceta(lote: { contenido_presentacion?: unknown; unidad_presentacion?: string | null; cantidad_restante: unknown }, linea: { contenido_requerido?: unknown; unidad_requerida?: string | null; envases_completos?: boolean }, unidadBase: string | null) {
  if (!linea.envases_completos && linea.contenido_requerido == null) return true;
  const contenido = Number(linea.contenido_requerido);
  if (!(contenido > 0) || Number(lote.contenido_presentacion) !== contenido) return false;
  if (linea.unidad_requerida && lote.unidad_presentacion !== linea.unidad_requerida) return false;
  const baseEnvase = unidadBase === 'pieza' ? 1 : contenido;
  return linea.envases_completos ? Number(lote.cantidad_restante) + 0.0001 >= baseEnvase : Number(lote.cantidad_restante)>0;
}
export function saldoEnvasesCompletos(cantidad: number, contenido: number, unidadBase: string | null) {
  const base = unidadBase === 'pieza' ? 1 : contenido;
  return Math.floor((cantidad + 0.00001) / base) * base;
}
