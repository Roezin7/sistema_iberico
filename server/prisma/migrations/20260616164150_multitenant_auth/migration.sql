-- ===========================================================================
--  Fase 1 — Multi-tenant + auth
--  Orden seguro: crear negocios -> insertar Ibérico -> columnas nullable ->
--  backfill -> NOT NULL -> índices/FK. Preserva las filas existentes.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('admin', 'empleado');

-- CreateTable: negocios
CREATE TABLE "negocios" (
    "id" BIGSERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "negocios_pkey" PRIMARY KEY ("id")
);

-- CreateTable: usuarios
CREATE TABLE "usuarios" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'empleado',
    "pin_hash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable: socios
CREATE TABLE "socios" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "socios_pkey" PRIMARY KEY ("id")
);

-- Sembrar el negocio Ibérico (necesario antes del backfill NOT NULL).
INSERT INTO "negocios" ("nombre", "tipo") VALUES ('Ibérico', 'bar');

-- AlterTable: agregar negocio_id como NULLABLE primero
ALTER TABLE "stores" ADD COLUMN "negocio_id" BIGINT;
ALTER TABLE "products" ADD COLUMN "negocio_id" BIGINT;
ALTER TABLE "inventory_snapshot" ADD COLUMN "negocio_id" BIGINT;
ALTER TABLE "purchases" ADD COLUMN "negocio_id" BIGINT;

-- Backfill: todas las filas existentes pertenecen a Ibérico.
UPDATE "stores"             SET "negocio_id" = (SELECT "id" FROM "negocios" WHERE "nombre" = 'Ibérico' LIMIT 1) WHERE "negocio_id" IS NULL;
UPDATE "products"           SET "negocio_id" = (SELECT "id" FROM "negocios" WHERE "nombre" = 'Ibérico' LIMIT 1) WHERE "negocio_id" IS NULL;
UPDATE "inventory_snapshot" SET "negocio_id" = (SELECT "id" FROM "negocios" WHERE "nombre" = 'Ibérico' LIMIT 1) WHERE "negocio_id" IS NULL;
UPDATE "purchases"          SET "negocio_id" = (SELECT "id" FROM "negocios" WHERE "nombre" = 'Ibérico' LIMIT 1) WHERE "negocio_id" IS NULL;

-- Ahora sí: NOT NULL
ALTER TABLE "stores"             ALTER COLUMN "negocio_id" SET NOT NULL;
ALTER TABLE "products"           ALTER COLUMN "negocio_id" SET NOT NULL;
ALTER TABLE "inventory_snapshot" ALTER COLUMN "negocio_id" SET NOT NULL;
ALTER TABLE "purchases"          ALTER COLUMN "negocio_id" SET NOT NULL;

-- DropConstraint: unicidad global de name -> pasa a ser por negocio
ALTER TABLE "products" DROP CONSTRAINT "products_name_key";
ALTER TABLE "stores" DROP CONSTRAINT "stores_name_key";

-- CreateIndex
CREATE INDEX "usuarios_negocio_id_idx" ON "usuarios"("negocio_id");
CREATE INDEX "socios_negocio_id_idx" ON "socios"("negocio_id");
CREATE INDEX "inventory_snapshot_negocio_id_idx" ON "inventory_snapshot"("negocio_id");
CREATE INDEX "products_negocio_id_idx" ON "products"("negocio_id");
CREATE UNIQUE INDEX "products_negocio_id_name_key" ON "products"("negocio_id", "name");
CREATE INDEX "purchases_negocio_id_idx" ON "purchases"("negocio_id");
CREATE INDEX "stores_negocio_id_idx" ON "stores"("negocio_id");
CREATE UNIQUE INDEX "stores_negocio_id_name_key" ON "stores"("negocio_id", "name");

-- AddForeignKey
ALTER TABLE "usuarios"           ADD CONSTRAINT "usuarios_negocio_id_fkey"           FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "socios"             ADD CONSTRAINT "socios_negocio_id_fkey"             FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products"           ADD CONSTRAINT "products_negocio_id_fkey"           FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases"          ADD CONSTRAINT "purchases_negocio_id_fkey"          FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stores"             ADD CONSTRAINT "stores_negocio_id_fkey"             FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
