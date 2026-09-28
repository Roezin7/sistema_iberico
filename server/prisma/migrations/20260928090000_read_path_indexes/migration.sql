-- Índices para las lecturas de inventario, conciliación y tablero.
-- Son deliberadamente aditivos y seguros de ejecutar en instalaciones existentes.
CREATE INDEX IF NOT EXISTS "inventory_snapshot_negocio_created_at_idx"
  ON "inventory_snapshot" ("negocio_id", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_lots_negocio_recibido_at_idx"
  ON "inventory_lots" ("negocio_id", "recibido_at");

CREATE INDEX IF NOT EXISTS "inventory_lots_negocio_estado_recibido_at_idx"
  ON "inventory_lots" ("negocio_id", "estado", "recibido_at");

CREATE INDEX IF NOT EXISTS "inventory_consumptions_negocio_fecha_epos_idx"
  ON "inventory_consumptions" ("negocio_id", "fecha", "epos_venta_id");

CREATE INDEX IF NOT EXISTS "inventory_adjustments_negocio_snapshot_product_idx"
  ON "inventory_adjustments" ("negocio_id", "snapshot_nuevo_id", "product_id");

CREATE INDEX IF NOT EXISTS "products_negocio_active_name_idx"
  ON "products" ("negocio_id", "active", "name");

CREATE INDEX IF NOT EXISTS "movimientos_negocio_semana_tipo_idx"
  ON "movimientos" ("negocio_id", "semana_id", "tipo");

CREATE INDEX IF NOT EXISTS "arqueos_negocio_semana_id_idx"
  ON "arqueos" ("negocio_id", "semana_id", "id");

CREATE INDEX IF NOT EXISTS "epos_ventas_negocio_fecha_costeo_idx"
  ON "epos_ventas" ("negocio_id", "fecha", "costeo_estado");
