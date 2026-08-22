CREATE TABLE "inventory_adjustments" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "zona_id" BIGINT NOT NULL,
    "cantidad_base" DECIMAL(14,4) NOT NULL,
    "factor" DECIMAL(12,4) NOT NULL,
    "cantidad_captura" DECIMAL(14,4) NOT NULL,
    "costo_unitario" DECIMAL(14,6) NOT NULL,
    "motivo" TEXT NOT NULL,
    "nota" TEXT,
    "solicitud_id" TEXT,
    "snapshot_anterior_id" BIGINT NOT NULL,
    "snapshot_nuevo_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_adjustments_negocio_id_semana_id_idx"
  ON "inventory_adjustments"("negocio_id", "semana_id");
CREATE INDEX "inventory_adjustments_negocio_id_product_id_idx"
  ON "inventory_adjustments"("negocio_id", "product_id");
CREATE UNIQUE INDEX "inventory_adjustments_negocio_id_solicitud_id_key"
  ON "inventory_adjustments"("negocio_id", "solicitud_id");

ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_semana_id_fkey"
  FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zonas_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_snapshot_anterior_id_fkey"
  FOREIGN KEY ("snapshot_anterior_id") REFERENCES "inventory_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_snapshot_nuevo_id_fkey"
  FOREIGN KEY ("snapshot_nuevo_id") REFERENCES "inventory_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
