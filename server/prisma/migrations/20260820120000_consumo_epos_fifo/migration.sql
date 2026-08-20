ALTER TABLE "epos_ventas"
  ADD COLUMN "costo_fifo" DECIMAL(14,4),
  ADD COLUMN "costeo_estado" TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN "costeo_error" TEXT,
  ADD COLUMN "costeado_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "inventory_consumptions_epos_venta_id_product_id_key"
  ON "inventory_consumptions"("epos_venta_id", "product_id");
