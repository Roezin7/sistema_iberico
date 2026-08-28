-- Auditoría sin mutaciones. Ejecutar con DATABASE_READONLY_URL desde Coolify.
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

-- Semanas con más de un registro de inventario (el esquema debe impedirlo).
SELECT negocio_id, semana_id, count(*) AS filas
FROM inventario_semanal
GROUP BY negocio_id, semana_id
HAVING count(*) > 1;
