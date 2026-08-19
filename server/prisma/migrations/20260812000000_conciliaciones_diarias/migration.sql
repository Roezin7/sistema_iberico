-- CreateEnum
CREATE TYPE "EstadoConciliacionDiaria" AS ENUM ('revision', 'confirmada');

-- CreateTable
CREATE TABLE "conciliaciones_diarias" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoConciliacionDiaria" NOT NULL DEFAULT 'revision',
    "epos_ventas" DECIMAL(12,2) NOT NULL,
    "epos_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "epos_tarjeta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "epos_otros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "confirmado_ventas" DECIMAL(12,2),
    "confirmado_efectivo" DECIMAL(12,2),
    "confirmado_tarjeta" DECIMAL(12,2),
    "confirmado_otros" DECIMAL(12,2),
    "cuentas_abiertas" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "excepciones_json" TEXT,
    "notas" TEXT,
    "usuario_id" BIGINT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_at" TIMESTAMPTZ(6),

    CONSTRAINT "conciliaciones_diarias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conciliaciones_diarias_negocio_id_fecha_key" ON "conciliaciones_diarias"("negocio_id", "fecha");
CREATE INDEX "conciliaciones_diarias_semana_id_idx" ON "conciliaciones_diarias"("semana_id");
CREATE INDEX "conciliaciones_diarias_negocio_id_idx" ON "conciliaciones_diarias"("negocio_id");

-- AddForeignKey
ALTER TABLE "conciliaciones_diarias" ADD CONSTRAINT "conciliaciones_diarias_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conciliaciones_diarias" ADD CONSTRAINT "conciliaciones_diarias_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conciliaciones_diarias" ADD CONSTRAINT "conciliaciones_diarias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
