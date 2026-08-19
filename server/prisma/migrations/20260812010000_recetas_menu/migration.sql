-- CreateTable
CREATE TABLE "productos_menu" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "epos_product_id" INTEGER,
    "precio_venta" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "productos_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas" (
    "id" BIGSERIAL NOT NULL,
    "producto_menu_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "fuente" TEXT,
    "notas" TEXT,
    "vigente_desde" DATE,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receta_lineas" (
    "receta_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,
    "unidad" TEXT NOT NULL,
    "nota" TEXT,
    CONSTRAINT "receta_lineas_pkey" PRIMARY KEY ("receta_id", "product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "productos_menu_negocio_id_nombre_key" ON "productos_menu"("negocio_id", "nombre");
CREATE INDEX "productos_menu_negocio_id_activo_idx" ON "productos_menu"("negocio_id", "activo");
CREATE INDEX "productos_menu_epos_product_id_idx" ON "productos_menu"("epos_product_id");
CREATE UNIQUE INDEX "recetas_producto_menu_id_version_key" ON "recetas"("producto_menu_id", "version");
CREATE INDEX "recetas_producto_menu_id_estado_idx" ON "recetas"("producto_menu_id", "estado");
CREATE INDEX "receta_lineas_product_id_idx" ON "receta_lineas"("product_id");

-- AddForeignKey
ALTER TABLE "productos_menu" ADD CONSTRAINT "productos_menu_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_producto_menu_id_fkey" FOREIGN KEY ("producto_menu_id") REFERENCES "productos_menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receta_lineas" ADD CONSTRAINT "receta_lineas_receta_id_fkey" FOREIGN KEY ("receta_id") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receta_lineas" ADD CONSTRAINT "receta_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
