-- El precio histórico sin su denominador revaluaba cierres al cambiar 750/700 ml.
ALTER TABLE "producto_costos_historicos"
  ALTER COLUMN "costo" DROP NOT NULL,
  ADD COLUMN "contenido_compra" DECIMAL(14,4),
  ADD COLUMN "unidad_base" TEXT,
  ADD COLUMN "vigente_desde" TIMESTAMPTZ(6),
  ADD COLUMN "fuente" TEXT;

-- Conserva la interpretación que tenían las referencias legadas antes del cambio.
-- No se afirma que sean precios de un ticket verificado.
UPDATE "producto_costos_historicos" h
SET "contenido_compra" = p."contenido_compra",
    "unidad_base" = p."unidad_base",
    "fuente" = 'referencia_legada_formato_catalogo'
FROM "products" p WHERE p."id" = h."product_id";
CREATE INDEX "producto_costos_historicos_product_id_vigente_desde_idx"
  ON "producto_costos_historicos"("product_id", "vigente_desde");

-- Las correcciones operativas anteriores al despliegue conservaron un antes/
-- después auditable. Recuperar su referencia previa sin tocar conteos ni pagos.
WITH cambios AS (
  SELECT DISTINCT ON ((a.antes::jsonb->'producto'->>'id')::bigint)
    (a.antes::jsonb->'producto'->>'id')::bigint AS product_id,
    a.antes::jsonb->'producto' AS anterior
  FROM auditoria_eventos a
  WHERE a.accion = 'corregir_presentacion_20261103' AND a.antes IS NOT NULL
  ORDER BY (a.antes::jsonb->'producto'->>'id')::bigint, a.id
)
INSERT INTO producto_costos_historicos
  (product_id, fecha, costo, contenido_compra, unidad_base, vigente_desde, fuente)
SELECT c.product_id, DATE '1970-01-01', (c.anterior->>'unit_cost')::numeric,
  (c.anterior->>'contenido_compra')::numeric, c.anterior->>'unidad_base',
  TIMESTAMPTZ '1970-01-01 00:00:00+00', 'referencia_inicial_catalogo_no_ticket'
FROM cambios c JOIN products p ON p.id = c.product_id
WHERE NOT EXISTS (SELECT 1 FROM producto_costos_historicos h
  WHERE h.product_id = c.product_id AND h.fuente = 'referencia_inicial_catalogo_no_ticket');

WITH cambios AS (
  SELECT DISTINCT ON ((a.antes::jsonb->'producto'->>'id')::bigint)
    (a.antes::jsonb->'producto'->>'id')::bigint AS product_id, a.creado_at,
    a.despues::jsonb->'producto' AS posterior
  FROM auditoria_eventos a
  WHERE a.accion = 'corregir_presentacion_20261103'
    AND a.antes IS NOT NULL AND a.despues IS NOT NULL
  ORDER BY (a.antes::jsonb->'producto'->>'id')::bigint, a.id
)
INSERT INTO producto_costos_historicos
  (product_id, fecha, costo, contenido_compra, unidad_base, vigente_desde, fuente)
SELECT c.product_id, c.creado_at::date, (c.posterior->>'unit_cost')::numeric,
  (c.posterior->>'contenido_compra')::numeric, c.posterior->>'unidad_base',
  c.creado_at, 'correccion_presentacion_20261103'
FROM cambios c JOIN products p ON p.id = c.product_id
WHERE NOT EXISTS (SELECT 1 FROM producto_costos_historicos h
  WHERE h.product_id = c.product_id AND h.fuente = 'correccion_presentacion_20261103');
