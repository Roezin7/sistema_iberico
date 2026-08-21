-- Evita duplicados concurrentes cuando un reintento llega antes de que la
-- aplicación pueda observar el ticket o la foto ya capturados.
CREATE UNIQUE INDEX "purchases_negocio_id_ticket_ref_key"
  ON "purchases"("negocio_id", "ticket_ref");

CREATE UNIQUE INDEX "purchases_negocio_id_foto_hash_key"
  ON "purchases"("negocio_id", "foto_hash");
