-- Comparar antes/después de publicar. No devuelve información personal ni modifica filas.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'movimientos' AS tabla,count(*) AS filas,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) AS huella FROM movimientos t WHERE negocio_id=1
UNION ALL SELECT 'arqueos',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) FROM arqueos t WHERE negocio_id=1
UNION ALL SELECT 'purchases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) FROM purchases t WHERE negocio_id=1
UNION ALL SELECT 'inventory_lots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) FROM inventory_lots t WHERE negocio_id=1
UNION ALL SELECT 'epos_ventas',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) FROM epos_ventas t WHERE negocio_id=1
UNION ALL SELECT 'inventory_consumptions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY id),'')) FROM inventory_consumptions t WHERE negocio_id=1
UNION ALL SELECT 'inventory_lines',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY snapshot_id,product_id,zona_id),'')) FROM inventory_lines t WHERE snapshot_id IN (SELECT id FROM inventory_snapshot WHERE negocio_id=1);
COMMIT;
