ALTER TABLE "inventory_snapshot"
  ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'conteo_operativo',
  ADD COLUMN "semana_id" BIGINT,
  ADD COLUMN "motivo" TEXT,
  ADD COLUMN "nota" TEXT;

CREATE INDEX "inventory_snapshot_negocio_id_tipo_semana_id_idx"
  ON "inventory_snapshot"("negocio_id", "tipo", "semana_id");

-- Preserve the historical chain without rewriting quantities.
UPDATE "inventory_snapshot" s
SET "tipo" = CASE
  WHEN EXISTS (SELECT 1 FROM "inventario_semanal" i WHERE i."cierre_snapshot_id" = s."id")
   AND EXISTS (SELECT 1 FROM "inventario_semanal" i WHERE i."apertura_snapshot_id" = s."id") THEN 'cierre_apertura'
  WHEN EXISTS (SELECT 1 FROM "inventario_semanal" i WHERE i."cierre_snapshot_id" = s."id") THEN 'cierre'
  WHEN EXISTS (SELECT 1 FROM "inventario_semanal" i WHERE i."apertura_snapshot_id" = s."id") THEN 'apertura'
  ELSE 'conteo_operativo'
END,
"semana_id" = COALESCE(
  (SELECT i."semana_id" FROM "inventario_semanal" i WHERE i."cierre_snapshot_id" = s."id" ORDER BY i."semana_id" DESC LIMIT 1),
  (SELECT i."semana_id" FROM "inventario_semanal" i WHERE i."apertura_snapshot_id" = s."id" ORDER BY i."semana_id" ASC LIMIT 1)
)
WHERE s."tipo" = 'conteo_operativo';
