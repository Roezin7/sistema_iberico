-- CreateEnum
CREATE TYPE "TipoUbicacion" AS ENUM ('banco', 'efectivo');

-- CreateEnum
CREATE TYPE "EstadoSemana" AS ENUM ('abierta', 'cerrada');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('venta_efectivo', 'venta_tarjeta', 'propina_tarjeta', 'comision_terminal', 'gasto', 'sueldo', 'compra_inventario', 'transferencia', 'retiro_socio', 'deposito', 'propina_pagada');

-- CreateTable
CREATE TABLE "ubicaciones_fondos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoUbicacion" NOT NULL,
    "socio_id" BIGINT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ubicaciones_fondos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_gasto" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_gasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semanas" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "estado" "EstadoSemana" NOT NULL DEFAULT 'abierta',
    "cerrada_at" TIMESTAMPTZ(6),

    CONSTRAINT "semanas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "ubicacion_origen_id" BIGINT,
    "ubicacion_destino_id" BIGINT,
    "categoria_id" BIGINT,
    "socio_id" BIGINT,
    "facturado" BOOLEAN NOT NULL DEFAULT false,
    "descripcion" TEXT,
    "usuario_id" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arqueos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "monto_real" DECIMAL(12,2) NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arqueos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldos_iniciales" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "saldos_iniciales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cierres_semana" (
    "id" BIGSERIAL NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "saldo_inicial" DECIMAL(12,2) NOT NULL,
    "saldo_teorico" DECIMAL(12,2) NOT NULL,
    "saldo_real" DECIMAL(12,2),
    "saldo_final" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cierres_semana_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ubicaciones_fondos_negocio_id_idx" ON "ubicaciones_fondos"("negocio_id");

-- CreateIndex
CREATE INDEX "categorias_gasto_negocio_id_idx" ON "categorias_gasto"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_gasto_negocio_id_nombre_key" ON "categorias_gasto"("negocio_id", "nombre");

-- CreateIndex
CREATE INDEX "semanas_negocio_id_idx" ON "semanas"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "semanas_negocio_id_fecha_inicio_key" ON "semanas"("negocio_id", "fecha_inicio");

-- CreateIndex
CREATE INDEX "movimientos_negocio_id_idx" ON "movimientos"("negocio_id");

-- CreateIndex
CREATE INDEX "movimientos_semana_id_idx" ON "movimientos"("semana_id");

-- CreateIndex
CREATE INDEX "arqueos_semana_id_idx" ON "arqueos"("semana_id");

-- CreateIndex
CREATE INDEX "arqueos_negocio_id_idx" ON "arqueos"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "saldos_iniciales_ubicacion_id_key" ON "saldos_iniciales"("ubicacion_id");

-- CreateIndex
CREATE INDEX "saldos_iniciales_negocio_id_idx" ON "saldos_iniciales"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "cierres_semana_semana_id_ubicacion_id_key" ON "cierres_semana"("semana_id", "ubicacion_id");

-- AddForeignKey
ALTER TABLE "ubicaciones_fondos" ADD CONSTRAINT "ubicaciones_fondos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_fondos" ADD CONSTRAINT "ubicaciones_fondos_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semanas" ADD CONSTRAINT "semanas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_ubicacion_origen_id_fkey" FOREIGN KEY ("ubicacion_origen_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_ubicacion_destino_id_fkey" FOREIGN KEY ("ubicacion_destino_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_gasto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciales" ADD CONSTRAINT "saldos_iniciales_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciales" ADD CONSTRAINT "saldos_iniciales_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cierres_semana" ADD CONSTRAINT "cierres_semana_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cierres_semana" ADD CONSTRAINT "cierres_semana_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones_fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

