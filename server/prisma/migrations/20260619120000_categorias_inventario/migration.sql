-- Categorías de inventario (alcohol, cocina, congelado, etc.) para agrupar productos.
CREATE TABLE "categorias_inventario" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "categorias_inventario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "categorias_inventario_negocio_id_idx" ON "categorias_inventario"("negocio_id");
CREATE UNIQUE INDEX "categorias_inventario_negocio_id_nombre_key" ON "categorias_inventario"("negocio_id", "nombre");

ALTER TABLE "categorias_inventario"
    ADD CONSTRAINT "categorias_inventario_negocio_id_fkey"
    FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "categoria_id" BIGINT;

ALTER TABLE "products"
    ADD CONSTRAINT "products_categoria_id_fkey"
    FOREIGN KEY ("categoria_id") REFERENCES "categorias_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
