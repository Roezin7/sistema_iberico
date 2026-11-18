-- 0_init creó índices únicos independientes, no restricciones de tabla.
-- DROP CONSTRAINT en multitenant_auth no eliminó esos índices en bases nuevas.
-- La unicidad correcta ya está definida por (negocio_id, name).
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_name_key";
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_name_key";
DROP INDEX IF EXISTS "products_name_key";
DROP INDEX IF EXISTS "stores_name_key";
