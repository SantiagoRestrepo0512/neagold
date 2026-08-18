-- Corrección: Prisma mapea String[] a TEXT[] (array nativo de PostgreSQL),
-- no a JSONB. La columna recovery_codes se creó como JSONB en la migración
-- inicial de FASE 4; se convierte a TEXT[] con columna temporal (ALTER USING
-- no admite subconsultas).

ALTER TABLE "mfa" ADD COLUMN "recovery_codes_text" TEXT[];

UPDATE "mfa" SET "recovery_codes_text" = ARRAY(
  SELECT jsonb_array_elements_text("recovery_codes")
);

ALTER TABLE "mfa" DROP COLUMN "recovery_codes";

ALTER TABLE "mfa" RENAME COLUMN "recovery_codes_text" TO "recovery_codes";