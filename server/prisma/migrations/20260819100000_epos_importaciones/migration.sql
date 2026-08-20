-- Ventas importadas de Epos Now: sólo lectura, idempotentes y auditables.
CREATE TABLE "epos_importaciones" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "clave" TEXT NOT NULL,
    "location_id" INTEGER,
    "periodo_desde" TIMESTAMPTZ(6) NOT NULL,
    "periodo_hasta" TIMESTAMPTZ(6) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'completada',
    "filas_recibidas" INTEGER NOT NULL DEFAULT 0,
    "filas_nuevas" INTEGER NOT NULL DEFAULT 0,
    "filas_duplicadas" INTEGER NOT NULL DEFAULT 0,
    "payload_json" TEXT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epos_importaciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "epos_ventas" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "importacion_id" BIGINT NOT NULL,
    "clave" TEXT NOT NULL,
    "epos_transaction_id" INTEGER,
    "epos_item_id" INTEGER,
    "fecha" TIMESTAMPTZ(6) NOT NULL,
    "epos_product_id" INTEGER,
    "producto_nombre" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,
    "venta_bruta" DECIMAL(12,2) NOT NULL,
    "venta_neta" DECIMAL(12,2),
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metodo_pago" TEXT NOT NULL,
    "raw_json" TEXT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epos_ventas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "epos_importaciones_negocio_id_clave_key" ON "epos_importaciones"("negocio_id", "clave");
CREATE INDEX "epos_importaciones_negocio_id_periodo_desde_idx" ON "epos_importaciones"("negocio_id", "periodo_desde");
CREATE UNIQUE INDEX "epos_ventas_negocio_id_clave_key" ON "epos_ventas"("negocio_id", "clave");
CREATE INDEX "epos_ventas_negocio_id_fecha_idx" ON "epos_ventas"("negocio_id", "fecha");
CREATE INDEX "epos_ventas_importacion_id_idx" ON "epos_ventas"("importacion_id");
CREATE INDEX "epos_ventas_negocio_id_epos_product_id_idx" ON "epos_ventas"("negocio_id", "epos_product_id");

ALTER TABLE "epos_importaciones" ADD CONSTRAINT "epos_importaciones_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "epos_ventas" ADD CONSTRAINT "epos_ventas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "epos_ventas" ADD CONSTRAINT "epos_ventas_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "epos_importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
