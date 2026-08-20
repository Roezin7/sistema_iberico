ALTER TABLE "purchases"
  ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'confirmada',
  ADD COLUMN "foto_data" TEXT,
  ADD COLUMN "foto_mime" TEXT,
  ADD COLUMN "foto_hash" TEXT,
  ADD COLUMN "ocr_json" TEXT,
  ADD COLUMN "origen_pago_id" BIGINT,
  ADD COLUMN "capturada_por" BIGINT,
  ADD COLUMN "confirmada_por" BIGINT,
  ADD COLUMN "confirmada_at" TIMESTAMPTZ(6);

CREATE INDEX "purchases_negocio_id_estado_fecha_recepcion_idx"
  ON "purchases"("negocio_id", "estado", "fecha_recepcion");
CREATE INDEX "purchases_origen_pago_id_idx" ON "purchases"("origen_pago_id");

CREATE TABLE "purchase_capture_lines" (
  "id" BIGSERIAL NOT NULL,
  "purchase_id" BIGINT NOT NULL,
  "product_id" BIGINT,
  "tipo_linea" TEXT NOT NULL DEFAULT 'pendiente',
  "descripcion_fuente" TEXT NOT NULL,
  "cantidad_base" DECIMAL(14,4),
  "unidad_compra" TEXT,
  "contenido_compra" DECIMAL(14,4),
  "costo_unitario" DECIMAL(14,6),
  "importe" DECIMAL(14,4) NOT NULL,
  "confianza" DECIMAL(5,4),
  "notas" TEXT,
  CONSTRAINT "purchase_capture_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_capture_lines_purchase_id_idx" ON "purchase_capture_lines"("purchase_id");
CREATE INDEX "purchase_capture_lines_product_id_idx" ON "purchase_capture_lines"("product_id");

ALTER TABLE "purchase_capture_lines"
  ADD CONSTRAINT "purchase_capture_lines_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_capture_lines"
  ADD CONSTRAINT "purchase_capture_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_origen_pago_id_fkey"
  FOREIGN KEY ("origen_pago_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_capturada_por_fkey"
  FOREIGN KEY ("capturada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_confirmada_por_fkey"
  FOREIGN KEY ("confirmada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "movimientos" ADD COLUMN "compra_id" BIGINT;
CREATE INDEX "movimientos_compra_id_idx" ON "movimientos"("compra_id");
ALTER TABLE "movimientos"
  ADD CONSTRAINT "movimientos_compra_id_fkey"
  FOREIGN KEY ("compra_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
