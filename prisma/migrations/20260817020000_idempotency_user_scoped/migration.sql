-- Idempotencia: alcance por usuario y deduplicación concurrente segura.
-- - Corrige el nombre de columna "responseBody" -> response_body (typo del init,
--   la tabla estaba vacía y sin uso).
-- - Añade user_id (NULL para clientes anónimos).
-- - La clave única pasa a (user_id, key, request_path) con NULLS NOT DISTINCT:
--   dos filas con user_id NULL y la misma (key, request_path) también colisionan,
--   por lo que la deduplicación aplica igual para peticiones sin sesión.

ALTER TABLE "idempotency_keys" RENAME COLUMN "responseBody" TO "response_body";

ALTER TABLE "idempotency_keys" ADD COLUMN "user_id" UUID;

DROP INDEX "idempotency_keys_key_request_path_key";

CREATE UNIQUE INDEX "idempotency_keys_user_id_key_request_path_key"
  ON "idempotency_keys"("user_id", "key", "request_path")
  NULLS NOT DISTINCT;

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
