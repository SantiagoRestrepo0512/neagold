-- FASE 4 - Auth: MFA TOTP (secreto cifrado en reposo, códigos de recuperación
-- hasheados), challenges de MFA de un solo uso y ventana de intentos de login
-- por (email, IP) para mitigar lockout DoS.

CREATE TABLE "mfa" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL UNIQUE,
  "secret_encrypted" VARCHAR(512) NOT NULL,
  "recovery_codes" JSONB NOT NULL,
  "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mfa_challenges" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "revoked_at" TIMESTAMPTZ(6),
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

CREATE TABLE "login_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(255) NOT NULL,
  "ip_address" VARCHAR(45) NOT NULL,
  "failed_count" INTEGER NOT NULL DEFAULT 1,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "login_attempts_email_ip_address_key" UNIQUE ("email", "ip_address")
);

CREATE INDEX "login_attempts_email_idx" ON "login_attempts"("email");