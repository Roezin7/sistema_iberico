-- Factor aplicado por renglón (snapshot del factor de product_zone_units al capturar).
-- Las filas existentes (histórico, ya en unidad base) reciben factor = 1.
ALTER TABLE "inventory_lines" ADD COLUMN "factor" DECIMAL(12,4) NOT NULL DEFAULT 1;
