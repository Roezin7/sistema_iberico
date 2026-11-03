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
  FROM recetas WHERE estado = 'validada' ORDER BY producto_menu_id, version DESC
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

COMMIT;
