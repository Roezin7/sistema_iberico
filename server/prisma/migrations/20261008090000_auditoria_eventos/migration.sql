CREATE TABLE "auditoria_eventos" (
  "id" BIGSERIAL NOT NULL,
  "negocio_id" BIGINT NOT NULL,
  "usuario_id" BIGINT,
  "entidad" TEXT NOT NULL,
  "entidad_id" TEXT,
  "accion" TEXT NOT NULL,
  "antes" TEXT,
  "despues" TEXT,
  "metadata" TEXT,
  "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auditoria_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auditoria_eventos_negocio_id_creado_at_idx" ON "auditoria_eventos"("negocio_id", "creado_at");
CREATE INDEX "auditoria_eventos_negocio_id_entidad_entidad_id_idx" ON "auditoria_eventos"("negocio_id", "entidad", "entidad_id");
CREATE INDEX "auditoria_eventos_usuario_id_idx" ON "auditoria_eventos"("usuario_id");

ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "inventory_lines_zona_id_snapshot_id_idx" ON "inventory_lines"("zona_id", "snapshot_id");
CREATE INDEX "inventory_lots_negocio_product_estado_recibido_idx" ON "inventory_lots"("negocio_id", "product_id", "estado", "recibido_at");
