-- Archivo mensual de facturas para compras pagadas desde Banco.
CREATE TABLE "facturas" (
  "id" BIGSERIAL NOT NULL,
  "negocio_id" BIGINT NOT NULL,
  "compra_id" BIGINT NOT NULL,
  "mes" DATE NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'no_facturado',
  "comprobante_data" TEXT,
  "comprobante_mime" TEXT,
  "comprobante_nombre" TEXT,
  "comprobante_hash" TEXT,
  "notas" TEXT,
  "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facturas_negocio_id_compra_id_key" ON "facturas"("negocio_id", "compra_id");
CREATE INDEX "facturas_negocio_id_mes_estado_idx" ON "facturas"("negocio_id", "mes", "estado");

ALTER TABLE "facturas" ADD CONSTRAINT "facturas_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_compra_id_fkey"
  FOREIGN KEY ("compra_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
