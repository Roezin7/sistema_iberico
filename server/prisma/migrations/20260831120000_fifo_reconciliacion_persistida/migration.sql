-- P0: evidencia persistida de la conciliación FIFO contra el inventario físico.
-- La tabla ya existe en algunas bases productivas por una migración manual;
-- todo el script es idempotente para no interrumpir esos despliegues.
CREATE TABLE IF NOT EXISTS "inventory_fifo_reconciliations" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "apertura_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "compras_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "consumo_teorico_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "fifo_esperado_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "fisico_final_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "diferencia_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costo_unitario_fifo" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "diferencia_valor" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "tipo_incidencia" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "notas" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_fifo_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_fifo_reconciliations_semana_id_product_id_key"
  ON "inventory_fifo_reconciliations"("semana_id", "product_id");
CREATE INDEX IF NOT EXISTS "inventory_fifo_reconciliations_negocio_id_semana_id_idx"
  ON "inventory_fifo_reconciliations"("negocio_id", "semana_id");
CREATE INDEX IF NOT EXISTS "inventory_fifo_reconciliations_negocio_id_product_id_idx"
  ON "inventory_fifo_reconciliations"("negocio_id", "product_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_fifo_reconciliations_negocio_id_fkey') THEN
    ALTER TABLE "inventory_fifo_reconciliations"
      ADD CONSTRAINT "inventory_fifo_reconciliations_negocio_id_fkey"
      FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_fifo_reconciliations_semana_id_fkey') THEN
    ALTER TABLE "inventory_fifo_reconciliations"
      ADD CONSTRAINT "inventory_fifo_reconciliations_semana_id_fkey"
      FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_fifo_reconciliations_product_id_fkey') THEN
    ALTER TABLE "inventory_fifo_reconciliations"
      ADD CONSTRAINT "inventory_fifo_reconciliations_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
