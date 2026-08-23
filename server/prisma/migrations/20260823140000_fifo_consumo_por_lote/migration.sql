-- Una venta puede consumir un mismo producto desde más de un lote FIFO.
-- La restricción anterior por venta/producto impedía registrar el split.
DROP INDEX IF EXISTS "inventory_consumptions_epos_venta_id_product_id_key";

CREATE UNIQUE INDEX "inventory_consumptions_epos_venta_id_product_id_lote_id_key"
  ON "inventory_consumptions"("epos_venta_id", "product_id", "lote_id");
