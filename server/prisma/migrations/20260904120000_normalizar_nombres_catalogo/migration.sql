-- Los IDs son la llave estable. Sólo normalizamos etiquetas visibles y
-- conservamos las grafías históricas como alias para ventas sin ProductID.
UPDATE "products"
SET "name" = 'Prosecco'
WHERE "negocio_id" = 1 AND "id" = 12 AND "name" = 'Prosseco';

UPDATE "products"
SET "name" = 'Pacífico'
WHERE "negocio_id" = 1 AND "id" = 38 AND "name" = 'Pacifico';

UPDATE "productos_menu"
SET "nombre" = 'Cuba de Hacienda de Tepa'
WHERE "negocio_id" = 1 AND "id" = 10 AND "nombre" = 'Cuba de hacienda de tepa';

UPDATE "productos_menu"
SET "nombre" = 'Pizza Madrileña (4 quesos)'
WHERE "negocio_id" = 1 AND "id" = 125 AND "nombre" = 'Pizza Madrileña';

UPDATE "productos_menu"
SET "nombre" = 'Cuba de Dobel Diamante'
WHERE "negocio_id" = 1 AND "id" = 146 AND "nombre" = 'CBA Doble D';

UPDATE "productos_menu"
SET "nombre" = 'Paloma Grande Dobel'
WHERE "negocio_id" = 1 AND "id" = 150 AND "nombre" = 'Paloma grande dobel';

INSERT INTO "product_aliases" ("product_id", "alias")
SELECT 12, 'Prosseco'
WHERE EXISTS (SELECT 1 FROM "products" WHERE "id" = 12 AND "negocio_id" = 1)
  AND NOT EXISTS (SELECT 1 FROM "product_aliases" WHERE "alias" = 'Prosseco');

INSERT INTO "product_aliases" ("product_id", "alias")
SELECT 38, 'Pacifico'
WHERE EXISTS (SELECT 1 FROM "products" WHERE "id" = 38 AND "negocio_id" = 1)
  AND NOT EXISTS (SELECT 1 FROM "product_aliases" WHERE "alias" = 'Pacifico');

-- Sólo retirar una versión duplicada del MISMO periodo. Las versiones de
-- fechas diferentes son necesarias para costear las ventas históricas.
UPDATE "recetas" AS antigua
SET "estado" = 'retirada'
WHERE antigua."id" = 16 AND antigua."producto_menu_id" = 20
  AND antigua."version" = 1 AND antigua."estado" = 'validada'
  AND EXISTS (SELECT 1 FROM "productos_menu" WHERE "id" = 20 AND "negocio_id" = 1)
  AND EXISTS (
    SELECT 1 FROM "recetas" nueva
    WHERE nueva."producto_menu_id" = antigua."producto_menu_id"
      AND nueva."version" = 2 AND nueva."estado" = 'validada'
      AND nueva."vigente_desde" IS NOT DISTINCT FROM antigua."vigente_desde"
  );
