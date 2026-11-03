-- Nulos conservan la evidencia legada: no se inventa hora de una recepción.
ALTER TABLE inventory_lines ADD COLUMN contado_at TIMESTAMPTZ(6);
ALTER TABLE purchases ADD COLUMN recibida_at TIMESTAMPTZ(6);
ALTER TABLE inventory_lot_transfers ADD COLUMN efectiva_at TIMESTAMPTZ(6);
CREATE INDEX purchases_negocio_id_recibida_at_idx ON purchases(negocio_id, recibida_at);
