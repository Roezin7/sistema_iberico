-- CreateTable
CREATE TABLE "silvia_mensajes" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "rol" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silvia_mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silvia_memoria" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "tipo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "fecha" DATE,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silvia_memoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "silvia_mensajes_negocio_id_idx" ON "silvia_mensajes"("negocio_id");

-- CreateIndex
CREATE INDEX "silvia_memoria_negocio_id_idx" ON "silvia_memoria"("negocio_id");

-- AddForeignKey
ALTER TABLE "silvia_mensajes" ADD CONSTRAINT "silvia_mensajes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silvia_memoria" ADD CONSTRAINT "silvia_memoria_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

