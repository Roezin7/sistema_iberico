-- CreateEnum
CREATE TYPE "TipoChecklist" AS ENUM ('apertura', 'cierre');

-- CreateTable
CREATE TABLE "checklists" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoChecklist" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" BIGSERIAL NOT NULL,
    "checklist_id" BIGINT NOT NULL,
    "texto" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_instancias" (
    "id" BIGSERIAL NOT NULL,
    "checklist_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'abierta',

    CONSTRAINT "checklist_instancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_item_resultados" (
    "id" BIGSERIAL NOT NULL,
    "instancia_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "completado" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" BIGINT,
    "completado_at" TIMESTAMPTZ(6),

    CONSTRAINT "checklist_item_resultados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklists_negocio_id_idx" ON "checklists"("negocio_id");

-- CreateIndex
CREATE INDEX "checklist_items_checklist_id_idx" ON "checklist_items"("checklist_id");

-- CreateIndex
CREATE INDEX "checklist_instancias_checklist_id_idx" ON "checklist_instancias"("checklist_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_instancias_checklist_id_fecha_key" ON "checklist_instancias"("checklist_id", "fecha");

-- CreateIndex
CREATE INDEX "checklist_item_resultados_instancia_id_idx" ON "checklist_item_resultados"("instancia_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_item_resultados_instancia_id_item_id_key" ON "checklist_item_resultados"("instancia_id", "item_id");

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_instancias" ADD CONSTRAINT "checklist_instancias_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_resultados" ADD CONSTRAINT "checklist_item_resultados_instancia_id_fkey" FOREIGN KEY ("instancia_id") REFERENCES "checklist_instancias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_resultados" ADD CONSTRAINT "checklist_item_resultados_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_resultados" ADD CONSTRAINT "checklist_item_resultados_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

