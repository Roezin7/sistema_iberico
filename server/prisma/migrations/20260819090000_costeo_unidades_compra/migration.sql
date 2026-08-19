-- Metadata de conversión para costear recetas por unidad base sin alterar
-- cantidades históricas de inventario.
ALTER TABLE "products"
  ADD COLUMN "unidad_base" TEXT,
  ADD COLUMN "contenido_compra" DECIMAL(14,4),
  ADD COLUMN "unidad_compra" TEXT,
  ADD COLUMN "rendimiento_util" DECIMAL(8,4) NOT NULL DEFAULT 1;

ALTER TABLE "products"
  ADD CONSTRAINT "products_rendimiento_util_check"
  CHECK ("rendimiento_util" > 0 AND "rendimiento_util" <= 1);
