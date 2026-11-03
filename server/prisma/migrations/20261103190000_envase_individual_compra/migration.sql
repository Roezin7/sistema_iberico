ALTER TABLE purchase_capture_lines ADD COLUMN contenido_presentacion numeric(14,4), ADD COLUMN unidad_presentacion text;
ALTER TABLE purchase_capture_lines ADD CONSTRAINT presentacion_individual_valida CHECK ((contenido_presentacion IS NULL AND unidad_presentacion IS NULL) OR (contenido_presentacion > 0 AND unidad_presentacion IN ('ml','g','pieza')));
