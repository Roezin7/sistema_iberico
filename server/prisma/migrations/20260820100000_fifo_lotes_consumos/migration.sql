CREATE TYPE "EstadoLoteInventario" AS ENUM ('abierto', 'agotado', 'cancelado');

CREATE TABLE "inventory_lots" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "purchase_id" BIGINT,
    "recibido_at" DATE NOT NULL,
    "cantidad_inicial" DECIMAL(14,4) NOT NULL,
    "cantidad_restante" DECIMAL(14,4) NOT NULL,
    "costo_unitario" DECIMAL(14,6) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "estado" "EstadoLoteInventario" NOT NULL DEFAULT 'abierto',
    "fuente" TEXT NOT NULL DEFAULT 'manual',
    "ticket_ref" TEXT,
    "notas" TEXT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_consumptions" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "lote_id" BIGINT NOT NULL,
    "epos_venta_id" BIGINT,
    "fecha" DATE NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "costo_unitario" DECIMAL(14,6) NOT NULL,
    "costo_total" DECIMAL(14,4) NOT NULL,
    "fuente" TEXT NOT NULL DEFAULT 'venta_receta',
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_lots_negocio_id_product_id_recibido_at_id_idx" ON "inventory_lots"("negocio_id", "product_id", "recibido_at", "id");
CREATE INDEX "inventory_lots_purchase_id_idx" ON "inventory_lots"("purchase_id");
CREATE INDEX "inventory_consumptions_negocio_id_fecha_idx" ON "inventory_consumptions"("negocio_id", "fecha");
CREATE INDEX "inventory_consumptions_lote_id_idx" ON "inventory_consumptions"("lote_id");
CREATE INDEX "inventory_consumptions_epos_venta_id_idx" ON "inventory_consumptions"("epos_venta_id");

ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_epos_venta_id_fkey" FOREIGN KEY ("epos_venta_id") REFERENCES "epos_ventas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
