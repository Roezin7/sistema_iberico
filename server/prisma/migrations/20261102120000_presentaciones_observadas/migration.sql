ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "presentacion_modo" TEXT NOT NULL DEFAULT 'exacta',
  ADD COLUMN IF NOT EXISTS "presentacion_nota" TEXT;

CREATE TABLE IF NOT EXISTS "product_presentation_variants" (
  "id" BIGSERIAL NOT NULL,
  "product_id" BIGINT NOT NULL,
  "unidad_compra" TEXT NOT NULL,
  "contenido_compra" DECIMAL(14,4),
  "unidad_base" TEXT,
  "observaciones" INTEGER NOT NULL DEFAULT 0,
  "costo_base_medio" DECIMAL(14,6),
  "primera_fecha" DATE,
  "ultima_fecha" DATE,
  "proveedores" TEXT,
  "es_canonica" BOOLEAN NOT NULL DEFAULT false,
  "notas" TEXT,
  CONSTRAINT "product_presentation_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_presentation_variants_unique"
  ON "product_presentation_variants"("product_id", "unidad_compra", "contenido_compra", "unidad_base");
CREATE INDEX IF NOT EXISTS "product_presentation_variants_product_id_idx"
  ON "product_presentation_variants"("product_id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_presentation_variants_product_id_fkey'
  ) THEN
    ALTER TABLE "product_presentation_variants"
      ADD CONSTRAINT "product_presentation_variants_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
