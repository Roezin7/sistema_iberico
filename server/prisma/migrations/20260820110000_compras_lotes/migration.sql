ALTER TABLE "purchases"
  ADD COLUMN "fecha_recepcion" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "proveedor" TEXT,
  ADD COLUMN "ticket_ref" TEXT,
  ADD COLUMN "total" DECIMAL(14,4),
  ADD COLUMN "moneda" TEXT NOT NULL DEFAULT 'MXN',
  ADD COLUMN "fuente" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "notas" TEXT;

ALTER TABLE "purchase_lines"
  ALTER COLUMN "qty" TYPE DECIMAL(14,4),
  ADD COLUMN "unidad_compra" TEXT,
  ADD COLUMN "contenido_compra" DECIMAL(14,4),
  ADD COLUMN "costo_unitario" DECIMAL(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN "importe" DECIMAL(14,4);
