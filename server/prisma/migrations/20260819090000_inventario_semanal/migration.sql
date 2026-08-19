-- Cadena semanal explícita de inventario.
CREATE TABLE "inventario_semanal" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "apertura_snapshot_id" BIGINT,
    "cierre_snapshot_id" BIGINT,
    "apertura_valor" DECIMAL(12,2),
    "cierre_valor" DECIMAL(12,2),
    "apertura_origen" TEXT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventario_semanal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventario_semanal_semana_id_key" ON "inventario_semanal"("semana_id");
CREATE INDEX "inventario_semanal_negocio_id_idx" ON "inventario_semanal"("negocio_id");
CREATE INDEX "inventario_semanal_apertura_snapshot_id_idx" ON "inventario_semanal"("apertura_snapshot_id");
CREATE INDEX "inventario_semanal_cierre_snapshot_id_idx" ON "inventario_semanal"("cierre_snapshot_id");

ALTER TABLE "inventario_semanal"
  ADD CONSTRAINT "inventario_semanal_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal"
  ADD CONSTRAINT "inventario_semanal_semana_id_fkey"
  FOREIGN KEY ("semana_id") REFERENCES "semanas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal"
  ADD CONSTRAINT "inventario_semanal_apertura_snapshot_id_fkey"
  FOREIGN KEY ("apertura_snapshot_id") REFERENCES "inventory_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal"
  ADD CONSTRAINT "inventario_semanal_cierre_snapshot_id_fkey"
  FOREIGN KEY ("cierre_snapshot_id") REFERENCES "inventory_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vincula semanas históricas con el último conteo disponible al momento de
-- abrirlas. No inventa cierres ni modifica snapshots existentes. El margen de
-- 24 horas cubre los conteos capturados la noche anterior en UTC.
INSERT INTO "inventario_semanal" (
  "negocio_id", "semana_id", "apertura_snapshot_id", "apertura_origen"
)
SELECT
  s."negocio_id",
  s."id",
  (
    SELECT i."id"
    FROM "inventory_snapshot" i
    WHERE i."negocio_id" = s."negocio_id"
      AND i."created_at" < (s."fecha_inicio" + INTERVAL '1 day')
    ORDER BY i."created_at" DESC, i."id" DESC
    LIMIT 1
  ),
  'migracion_conteo_historico'
FROM "semanas" s;

UPDATE "inventario_semanal" iw
SET "apertura_valor" = COALESCE((
  SELECT SUM(il."qty_captura" * il."factor" * COALESCE(p."unit_cost", 0))
  FROM "inventory_lines" il
  JOIN "products" p ON p."id" = il."product_id"
  WHERE il."snapshot_id" = iw."apertura_snapshot_id"
), 0)
WHERE iw."apertura_snapshot_id" IS NOT NULL;
