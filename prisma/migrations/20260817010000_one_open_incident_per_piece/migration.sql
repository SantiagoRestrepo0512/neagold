-- Invariante: maxima un incidente abierto (ACTIVE | UNDER_REVIEW) por pieza.
-- Complementa la validacion en capa de aplicacion ante requests concurrentes.
CREATE UNIQUE INDEX "uq_incidents_one_open_per_piece"
  ON "incidents" ("piece_id")
  WHERE ("status" IN ('ACTIVE', 'UNDER_REVIEW'));