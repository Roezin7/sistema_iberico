-- ===========================================================================
--  Fase 2 — Inventario v2: zonas + unidades de captura por zona.
--  Preserva los inventory_lines históricos (se reasignan a la zona 'Local').
-- ===========================================================================

-- 1) Tablas nuevas -----------------------------------------------------------
CREATE TABLE "zonas_inventario" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "zonas_inventario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_zone_units" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "zona_id" BIGINT NOT NULL,
    "unidad_captura" TEXT NOT NULL,
    "factor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    CONSTRAINT "product_zone_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "producto_costos_historicos" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "costo" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "producto_costos_historicos_pkey" PRIMARY KEY ("id")
);

-- 2) Sembrar zonas de Ibérico: Local(1), Bodega(2) --------------------------
INSERT INTO "zonas_inventario" ("negocio_id", "nombre", "orden")
SELECT n.id, 'Local', 1 FROM "negocios" n WHERE n.nombre = 'Ibérico'
UNION ALL
SELECT n.id, 'Bodega', 2 FROM "negocios" n WHERE n.nombre = 'Ibérico';

-- 3) Migrar inventory_lines a por-zona --------------------------------------
-- 3a) renombrar qty -> qty_captura (conserva datos)
ALTER TABLE "inventory_lines" RENAME COLUMN "qty" TO "qty_captura";
-- 3b) agregar zona_id nullable
ALTER TABLE "inventory_lines" ADD COLUMN "zona_id" BIGINT;
-- 3c) backfill: todo lo histórico fue contado en 'Local'
UPDATE "inventory_lines" il
SET "zona_id" = (
  SELECT z.id FROM "zonas_inventario" z
  JOIN "inventory_snapshot" s ON s.id = il.snapshot_id
  WHERE z.negocio_id = s.negocio_id AND z.nombre = 'Local'
  LIMIT 1
)
WHERE il."zona_id" IS NULL;
-- 3d) NOT NULL
ALTER TABLE "inventory_lines" ALTER COLUMN "zona_id" SET NOT NULL;
-- 3e) nueva PK incluyendo zona
ALTER TABLE "inventory_lines" DROP CONSTRAINT "inventory_lines_pkey";
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("snapshot_id", "product_id", "zona_id");

-- 4) Índices y unicidad ------------------------------------------------------
CREATE UNIQUE INDEX "zonas_inventario_negocio_id_nombre_key" ON "zonas_inventario"("negocio_id", "nombre");
CREATE INDEX "zonas_inventario_negocio_id_idx" ON "zonas_inventario"("negocio_id");
CREATE UNIQUE INDEX "product_zone_units_product_id_zona_id_key" ON "product_zone_units"("product_id", "zona_id");
CREATE INDEX "product_zone_units_zona_id_idx" ON "product_zone_units"("zona_id");
CREATE INDEX "producto_costos_historicos_product_id_idx" ON "producto_costos_historicos"("product_id");
CREATE INDEX "inventory_lines_zona_id_idx" ON "inventory_lines"("zona_id");

-- 5) Foreign keys ------------------------------------------------------------
ALTER TABLE "zonas_inventario" ADD CONSTRAINT "zonas_inventario_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_zone_units" ADD CONSTRAINT "product_zone_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_zone_units" ADD CONSTRAINT "product_zone_units_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zonas_inventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producto_costos_historicos" ADD CONSTRAINT "producto_costos_historicos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zonas_inventario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 6) Completar costos faltantes (estimados Costco MX; el usuario los verifica)
UPDATE "products" SET "unit_cost" = 199 WHERE "id" = 77;  -- Guantes
UPDATE "products" SET "unit_cost" = 150 WHERE "id" = 61;  -- Nieve
UPDATE "products" SET "unit_cost" = 199 WHERE "id" = 62;  -- Papas a la francesa
UPDATE "products" SET "unit_cost" = 250 WHERE "id" = 64;  -- Papel plástico
UPDATE "products" SET "unit_cost" = 180 WHERE "id" = 66;  -- Papel impresora pedidos
UPDATE "products" SET "unit_cost" = 80  WHERE "id" = 54;  -- Fresas
UPDATE "products" SET "unit_cost" = 0   WHERE "id" = 6;   -- Otros (bucket)

-- 7) Sembrar unidades de captura por zona -----------------------------------
-- Cervezas (35 Corona, 36 Victoria, 37 Modelo, 38 Pacífico, 39 Stella, 40 Ultra):
--   Local = rejilla_% (1 rejilla llena = 48) ; Bodega = caja (1 caja = 24).
INSERT INTO "product_zone_units" ("product_id", "zona_id", "unidad_captura", "factor")
SELECT p.id, zl.id, 'rejilla_%', 48
FROM "products" p
JOIN "zonas_inventario" zl ON zl.negocio_id = p.negocio_id AND zl.nombre = 'Local'
WHERE p.id IN (35,36,37,38,39,40);

INSERT INTO "product_zone_units" ("product_id", "zona_id", "unidad_captura", "factor")
SELECT p.id, zb.id, 'caja', 24
FROM "products" p
JOIN "zonas_inventario" zb ON zb.negocio_id = p.negocio_id AND zb.nombre = 'Bodega'
WHERE p.id IN (35,36,37,38,39,40);

-- Booleanos (77 Guantes, 78 Queso amarillo): unidad 'boolean', factor 1, en ambas zonas.
INSERT INTO "product_zone_units" ("product_id", "zona_id", "unidad_captura", "factor")
SELECT p.id, z.id, 'boolean', 1
FROM "products" p
JOIN "zonas_inventario" z ON z.negocio_id = p.negocio_id AND z.nombre IN ('Local','Bodega')
WHERE p.id IN (77,78);
