-- Las compras históricas ya fueron recibidas físicamente en Bodega. Los
-- lotes de apertura/ajuste sin zona quedan nulos para no inventar su ubicación.
UPDATE "inventory_lots" l
SET "zona_id" = z."id"
FROM "zonas_inventario" z
WHERE l."negocio_id" = z."negocio_id"
  AND z."nombre" = 'Bodega'
  AND l."purchase_id" IS NOT NULL
  AND l."zona_id" IS NULL;
