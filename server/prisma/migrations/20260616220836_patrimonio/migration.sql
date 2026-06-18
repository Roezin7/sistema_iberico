-- CreateTable
CREATE TABLE "pasivos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "tipo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pasivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots_patrimonio" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "total_banco" DECIMAL(12,2) NOT NULL,
    "total_efectivo" DECIMAL(12,2) NOT NULL,
    "total_inventario" DECIMAL(12,2) NOT NULL,
    "total_pasivos" DECIMAL(12,2) NOT NULL,
    "patrimonio_neto" DECIMAL(12,2) NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_patrimonio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pasivos_negocio_id_idx" ON "pasivos"("negocio_id");

-- CreateIndex
CREATE INDEX "snapshots_patrimonio_negocio_id_idx" ON "snapshots_patrimonio"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_patrimonio_negocio_id_fecha_key" ON "snapshots_patrimonio"("negocio_id", "fecha");

-- AddForeignKey
ALTER TABLE "pasivos" ADD CONSTRAINT "pasivos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots_patrimonio" ADD CONSTRAINT "snapshots_patrimonio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

