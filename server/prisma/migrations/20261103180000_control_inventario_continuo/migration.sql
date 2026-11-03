ALTER TABLE purchases ADD COLUMN solicitud_id TEXT, ADD COLUMN solicitud_hash TEXT;
ALTER TABLE inventory_lines ALTER COLUMN qty_captura TYPE DECIMAL(14,4);
CREATE UNIQUE INDEX purchases_negocio_id_solicitud_id_key ON purchases(negocio_id, solicitud_id);
ALTER TABLE inventory_lots
 ADD COLUMN disponible_desde TIMESTAMPTZ(6), ADD COLUMN orden_fifo_at TIMESTAMPTZ(6),
 ADD COLUMN contenido_presentacion DECIMAL(14,4), ADD COLUMN unidad_presentacion TEXT,
 ADD COLUMN costo_estimado BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN lote_origen_id BIGINT REFERENCES inventory_lots(id), ADD COLUMN cierre_control_id BIGINT;
ALTER TABLE inventory_consumptions ADD COLUMN efectiva_at TIMESTAMPTZ(6), ADD COLUMN operacion_linea_id BIGINT,
 ADD COLUMN lote_original_id BIGINT REFERENCES inventory_lots(id);
ALTER TABLE receta_lineas ADD COLUMN contenido_requerido DECIMAL(14,4), ADD COLUMN unidad_requerida TEXT,
 ADD COLUMN envases_completos BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE inventory_control_closures (
 id BIGSERIAL PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id),
 semana_id BIGINT NOT NULL UNIQUE REFERENCES semanas(id), snapshot_id BIGINT NOT NULL REFERENCES inventory_snapshot(id),
 apertura_snapshot_id BIGINT NOT NULL REFERENCES inventory_snapshot(id), siguiente_snapshot_id BIGINT REFERENCES inventory_snapshot(id),
 corte_at TIMESTAMPTZ(6) NOT NULL, solicitud_id TEXT NOT NULL, usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
 resumen JSONB NOT NULL, creado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
 UNIQUE(negocio_id, solicitud_id)
);
ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_cierre_control_id_fkey FOREIGN KEY(cierre_control_id) REFERENCES inventory_control_closures(id);
CREATE TABLE inventory_variance_cases (
 id BIGSERIAL PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id),
 cierre_id BIGINT NOT NULL REFERENCES inventory_control_closures(id), semana_id BIGINT NOT NULL REFERENCES semanas(id),
 product_id BIGINT NOT NULL REFERENCES products(id), origen TEXT NOT NULL,
 esperado DECIMAL(14,4) NOT NULL, contado DECIMAL(14,4) NOT NULL, diferencia DECIMAL(14,4) NOT NULL,
 costo_unitario DECIMAL(14,6), costo_estimado BOOLEAN NOT NULL DEFAULT FALSE,
 causa TEXT NOT NULL DEFAULT 'sin_explicar', estado TEXT NOT NULL DEFAULT 'abierta',
 responsable TEXT, evidencia TEXT, nota TEXT, version INTEGER NOT NULL DEFAULT 1,
 creado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(), actualizado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
 UNIQUE(cierre_id, product_id, origen), CHECK(origen IN ('semanal','arrastre_previo')),
 CHECK(estado IN ('abierta','investigando','documentada'))
);
CREATE INDEX inventory_variance_cases_negocio_semana_idx ON inventory_variance_cases(negocio_id,semana_id);
CREATE INDEX inventory_variance_cases_negocio_producto_idx ON inventory_variance_cases(negocio_id,product_id);
CREATE TABLE inventory_operations (
 id BIGSERIAL PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id), semana_id BIGINT NOT NULL REFERENCES semanas(id),
 tipo TEXT NOT NULL, efectiva_at TIMESTAMPTZ(6) NOT NULL, motivo TEXT NOT NULL, responsable TEXT NOT NULL,
 solicitud_id TEXT NOT NULL, solicitud_hash TEXT NOT NULL, usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
 epos_venta_id BIGINT UNIQUE REFERENCES epos_ventas(id), creado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
 UNIQUE(negocio_id,solicitud_id), CHECK(tipo IN ('merma','cortesia','consumo_interno','produccion'))
);
CREATE TABLE inventory_operation_lines (
 id BIGSERIAL PRIMARY KEY, operacion_id BIGINT NOT NULL REFERENCES inventory_operations(id), product_id BIGINT NOT NULL REFERENCES products(id),
 zona_id BIGINT NOT NULL REFERENCES zonas_inventario(id), cantidad DECIMAL(14,4) NOT NULL,
 costo_total DECIMAL(14,4), pendiente_cantidad DECIMAL(14,4) NOT NULL DEFAULT 0,
 costo_estimado BOOLEAN NOT NULL DEFAULT FALSE, contenido_presentacion DECIMAL(14,4), unidad_presentacion TEXT,
 CHECK(cantidad <> 0), CHECK(pendiente_cantidad >= 0)
);
ALTER TABLE inventory_consumptions ADD CONSTRAINT inventory_consumptions_operacion_linea_id_fkey FOREIGN KEY(operacion_linea_id) REFERENCES inventory_operation_lines(id);
ALTER TABLE inventory_lots ADD COLUMN operacion_linea_id BIGINT REFERENCES inventory_operation_lines(id);
CREATE INDEX inventory_operations_negocio_fecha_idx ON inventory_operations(negocio_id,efectiva_at);
CREATE TABLE inventory_count_formats (
 snapshot_id BIGINT NOT NULL REFERENCES inventory_snapshot(id), product_id BIGINT NOT NULL REFERENCES products(id),
 zona_id BIGINT NOT NULL REFERENCES zonas_inventario(id), contenido DECIMAL(14,4) NOT NULL,
 unidad TEXT NOT NULL, envases DECIMAL(14,4) NOT NULL,
 PRIMARY KEY(snapshot_id,product_id,zona_id,contenido,unidad), CHECK(contenido>0), CHECK(envases>=0)
);
