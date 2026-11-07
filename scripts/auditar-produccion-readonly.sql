-- Auditoría sin mutaciones. Ejecutar con DATABASE_READONLY_URL desde Coolify.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database, current_user AS user_name, now() AS checked_at;
SELECT 'negocios' AS tabla, count(*)::bigint AS filas FROM negocios
UNION ALL SELECT 'semanas', count(*) FROM semanas
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'productos_menu', count(*) FROM productos_menu
UNION ALL SELECT 'epos_ventas', count(*) FROM epos_ventas
UNION ALL SELECT 'inventory_lots', count(*) FROM inventory_lots
UNION ALL SELECT 'inventory_consumptions', count(*) FROM inventory_consumptions
UNION ALL SELECT 'inventory_snapshots', count(*) FROM inventory_snapshot;

-- Filas huérfanas o fuera de negocio: deben regresar cero.
SELECT 'epos_ventas_sin_negocio' AS control, count(*)::bigint AS filas
FROM epos_ventas e LEFT JOIN negocios n ON n.id = e.negocio_id WHERE n.id IS NULL
UNION ALL SELECT 'lotes_sin_negocio', count(*) FROM inventory_lots l LEFT JOIN negocios n ON n.id = l.negocio_id WHERE n.id IS NULL
UNION ALL SELECT 'consumos_sin_negocio', count(*) FROM inventory_consumptions c LEFT JOIN negocios n ON n.id = c.negocio_id WHERE n.id IS NULL;

-- Unicidad de venta/producto/lote (idempotencia).
SELECT epos_venta_id, product_id, lote_id, count(*) AS duplicados
FROM inventory_consumptions
WHERE epos_venta_id IS NOT NULL
GROUP BY epos_venta_id, product_id, lote_id
HAVING count(*) > 1;

-- Datos maestros incompletos: registrar el pendiente, no inventar tamaños/precios.
SELECT id, nombre, epos_product_id, precio_venta
FROM productos_menu WHERE activo AND (epos_product_id IS NULL OR precio_venta IS NULL OR precio_venta <= 0)
ORDER BY nombre;

-- Última receta validada: botellas completas que contradicen una presentación exacta.
WITH vigentes AS (
  SELECT DISTINCT ON (producto_menu_id) id, producto_menu_id
  FROM recetas WHERE estado = 'validada' AND (vigente_desde IS NULL OR vigente_desde <= (now() AT TIME ZONE 'America/Mexico_City')::date)
  ORDER BY producto_menu_id, version DESC
)
SELECT m.nombre, p.name AS insumo, l.cantidad, l.unidad, p.contenido_compra AS contenido_catalogo
FROM vigentes r JOIN productos_menu m ON m.id=r.producto_menu_id
JOIN receta_lineas l ON l.receta_id=r.id JOIN products p ON p.id=l.product_id
WHERE m.activo AND (m.nombre ILIKE '%botella%' OR m.nombre ILIKE 'servicio%')
  AND p.presentacion_modo='exacta' AND l.unidad=p.unidad_base
  AND l.cantidad >= 500 AND p.contenido_compra IS NOT NULL
  AND abs(l.cantidad-p.contenido_compra)>0.01;

-- Integridad de saldos de lotes y estado del costeo.
SELECT negocio_id, count(*) AS lotes_invalidos FROM inventory_lots
WHERE cantidad_restante<0 OR cantidad_restante>cantidad_inicial
  OR (estado='abierto' AND cantidad_restante<=0) GROUP BY negocio_id;
SELECT negocio_id, costeo_estado, count(*) AS ventas, count(*) FILTER(WHERE costo_fifo IS NULL) AS sin_costo
FROM epos_ventas GROUP BY negocio_id,costeo_estado;

-- Desfase de semana civil: no abrir/cerrar automáticamente con saldos pendientes.
SELECT id, etiqueta, fecha_fin, estado FROM semanas
WHERE estado='abierta' AND fecha_fin < (now() AT TIME ZONE 'America/Mexico_City')::date;

-- Semanas con más de un registro de inventario (el esquema debe impedirlo).
SELECT negocio_id, semana_id, count(*) AS filas
FROM inventario_semanal
GROUP BY negocio_id, semana_id
HAVING count(*) > 1;

-- Integridad entre referencias: una FK existente no acredita mismo negocio.
SELECT 'producto_proveedor_ajeno' AS control, count(*)::bigint AS filas
FROM products p JOIN stores s ON s.id=p.store_id WHERE p.negocio_id<>s.negocio_id
UNION ALL SELECT 'producto_categoria_ajena',count(*) FROM products p JOIN categorias_inventario c ON c.id=p.categoria_id WHERE p.negocio_id<>c.negocio_id
UNION ALL SELECT 'receta_insumo_ajeno',count(*) FROM receta_lineas l JOIN recetas r ON r.id=l.receta_id JOIN productos_menu m ON m.id=r.producto_menu_id JOIN products p ON p.id=l.product_id WHERE m.negocio_id<>p.negocio_id
UNION ALL SELECT 'lote_producto_ajeno',count(*) FROM inventory_lots l JOIN products p ON p.id=l.product_id WHERE l.negocio_id<>p.negocio_id
UNION ALL SELECT 'conteo_producto_ajeno',count(*) FROM inventory_lines l JOIN inventory_snapshot s ON s.id=l.snapshot_id JOIN products p ON p.id=l.product_id WHERE s.negocio_id<>p.negocio_id
UNION ALL SELECT 'movimiento_origen_ajeno',count(*) FROM movimientos m JOIN ubicaciones_fondos u ON u.id=m.ubicacion_origen_id WHERE m.negocio_id<>u.negocio_id
UNION ALL SELECT 'movimiento_destino_ajeno',count(*) FROM movimientos m JOIN ubicaciones_fondos u ON u.id=m.ubicacion_destino_id WHERE m.negocio_id<>u.negocio_id
UNION ALL SELECT 'movimiento_categoria_ajena',count(*) FROM movimientos m JOIN categorias_gasto c ON c.id=m.categoria_id WHERE m.negocio_id<>c.negocio_id;

-- No considerar conciliado sólo porque coincide el total: métodos también.
SELECT id,fecha,epos_ventas,confirmado_ventas,epos_efectivo,confirmado_efectivo,epos_tarjeta,confirmado_tarjeta
FROM conciliaciones_diarias
WHERE abs(epos_ventas-epos_efectivo-epos_tarjeta-epos_otros)>0.01
 OR abs(confirmado_ventas-confirmado_efectivo-confirmado_tarjeta-confirmado_otros)>0.01;

SELECT negocio_id,epos_product_id,count(*) AS menus_activos
FROM productos_menu WHERE activo AND epos_product_id>0
GROUP BY negocio_id,epos_product_id HAVING count(*)>1;

-- Separar compra/pago de costo: la suma de líneas del ticket debe cuadrar,
-- pero nunca reexpresar una compra histórica automáticamente para hacerlo.
SELECT p.id,p.fecha_recepcion,p.total,sum(cl.importe) AS suma_lineas
FROM purchases p JOIN purchase_capture_lines cl ON cl.purchase_id=p.id
WHERE p.estado='confirmada'
GROUP BY p.id,p.fecha_recepcion,p.total
HAVING abs(p.total-sum(cl.importe))>0.01;

COMMIT;
