-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AuthStage" AS ENUM ('NONE', 'MFA_PENDING', 'MFA_VERIFIED');

-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('IN_STOCK', 'AVAILABLE', 'SOLD', 'IN_SERVICE', 'REPORTED_STOLEN', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "QrStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'RECOVERED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('STOLEN', 'LOST', 'FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('AUTHENTICITY', 'APPRAISAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('FIRST_REGISTRATION', 'SALE', 'CLAIM', 'TRANSFER', 'RECOVERY');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('CLEANING', 'REPAIR', 'RESIZE', 'COMPONENT_REPLACEMENT', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimCodeStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TRANSFER_REQUEST', 'TRANSFER_ACCEPTED', 'TRANSFER_REJECTED', 'PIECE_REPORTED', 'PIECE_RECOVERED', 'CERTIFICATE_ISSUED', 'SERVICE_COMPLETED', 'CLAIM_AVAILABLE', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(120) NOT NULL,
    "last_name" VARCHAR(120) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "auth_stage" "AuthStage" NOT NULL DEFAULT 'NONE',
    "email_verified_at" TIMESTAMPTZ(6),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100) NOT NULL,
    "base_purity" VARCHAR(20) NOT NULL,
    "base_weight_grams" DECIMAL(10,3),
    "image_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jewelry_pieces" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "internal_id" VARCHAR(50) NOT NULL,
    "public_id" VARCHAR(26) NOT NULL,
    "serial_number" VARCHAR(30) NOT NULL,
    "weight_grams" DECIMAL(10,3) NOT NULL,
    "purity" VARCHAR(20) NOT NULL,
    "material" VARCHAR(50) NOT NULL,
    "manufacturing_date" TIMESTAMPTZ(6) NOT NULL,
    "status" "PieceStatus" NOT NULL DEFAULT 'IN_STOCK',
    "registered_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jewelry_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "serial_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "digital_identities" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "public_token" CHAR(64) NOT NULL,
    "identity_hash" CHAR(64) NOT NULL,
    "status" "IdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "digital_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "token" CHAR(64) NOT NULL,
    "status" "QrStatus" NOT NULL DEFAULT 'ACTIVE',
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_records" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6),
    "acquisition_type" "AcquisitionType" NOT NULL,
    "transfer_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_claim_codes" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "status" "ClaimCodeStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "used_by" UUID,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sale_id" UUID,

    CONSTRAINT "piece_claim_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "sold_by" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sale_date" TIMESTAMPTZ(6) NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "certificate_number" VARCHAR(50) NOT NULL,
    "type" "CertificateType" NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_by" UUID NOT NULL,
    "document_hash" CHAR(64) NOT NULL,
    "file_url" VARCHAR(500),
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "reported_by" UUID NOT NULL,
    "description" TEXT,
    "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "report_number" VARCHAR(50) NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_records" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "type" "ServiceType" NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID,
    "performed_by" UUID,
    "notes" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_path" VARCHAR(255) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "responseBody" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "jewelry_pieces_internal_id_key" ON "jewelry_pieces"("internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "jewelry_pieces_public_id_key" ON "jewelry_pieces"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "jewelry_pieces_serial_number_key" ON "jewelry_pieces"("serial_number");

-- CreateIndex
CREATE INDEX "jewelry_pieces_product_id_idx" ON "jewelry_pieces"("product_id");

-- CreateIndex
CREATE INDEX "jewelry_pieces_status_idx" ON "jewelry_pieces"("status");

-- CreateIndex
CREATE UNIQUE INDEX "digital_identities_piece_id_key" ON "digital_identities"("piece_id");

-- CreateIndex
CREATE UNIQUE INDEX "digital_identities_public_token_key" ON "digital_identities"("public_token");

-- CreateIndex
CREATE INDEX "digital_identities_public_token_status_idx" ON "digital_identities"("public_token", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "qr_codes_piece_id_idx" ON "qr_codes"("piece_id");

-- CreateIndex
CREATE INDEX "ownership_records_piece_id_end_date_idx" ON "ownership_records"("piece_id", "end_date");

-- CreateIndex
CREATE INDEX "ownership_records_owner_id_end_date_idx" ON "ownership_records"("owner_id", "end_date");

-- CreateIndex
CREATE INDEX "ownership_transfers_to_user_id_status_idx" ON "ownership_transfers"("to_user_id", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_piece_id_idx" ON "ownership_transfers"("piece_id");

-- CreateIndex
CREATE UNIQUE INDEX "piece_claim_codes_code_hash_key" ON "piece_claim_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "piece_claim_codes_sale_id_key" ON "piece_claim_codes"("sale_id");

-- CreateIndex
CREATE INDEX "piece_claim_codes_piece_id_idx" ON "piece_claim_codes"("piece_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_piece_id_key" ON "sales"("piece_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_number_key" ON "sales"("invoice_number");

-- CreateIndex
CREATE INDEX "sales_buyer_id_idx" ON "sales"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_number_key" ON "certificates"("certificate_number");

-- CreateIndex
CREATE INDEX "certificates_piece_id_idx" ON "certificates"("piece_id");

-- CreateIndex
CREATE INDEX "incidents_piece_id_status_idx" ON "incidents"("piece_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incident_reports_report_number_key" ON "incident_reports"("report_number");

-- CreateIndex
CREATE INDEX "incident_reports_incident_id_idx" ON "incident_reports"("incident_id");

-- CreateIndex
CREATE INDEX "service_records_piece_id_idx" ON "service_records"("piece_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_request_path_key" ON "idempotency_keys"("key", "request_path");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jewelry_pieces" ADD CONSTRAINT "jewelry_pieces_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jewelry_pieces" ADD CONSTRAINT "jewelry_pieces_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_identities" ADD CONSTRAINT "digital_identities_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "ownership_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_claim_codes" ADD CONSTRAINT "piece_claim_codes_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_claim_codes" ADD CONSTRAINT "piece_claim_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_claim_codes" ADD CONSTRAINT "piece_claim_codes_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_claim_codes" ADD CONSTRAINT "piece_claim_codes_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_fkey" FOREIGN KEY ("sold_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "jewelry_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Invariantes de negocio (SQL manual - no soportados por Prisma schema)
-- ===========================================================================

-- 1) Maximo una transferencia PENDING por pieza (partial unique index).
--    Previene solicitudes de transferencia duplicadas en estado pendiente.
CREATE UNIQUE INDEX "uq_ownership_transfers_one_pending_per_piece"
  ON "ownership_transfers" ("piece_id")
  WHERE ("status" = 'PENDING');

-- 2) Maximo un propietario activo por pieza (trigger).
--    Invariante critico: una pieza nunca puede tener dos ownership_records
--    abiertos (end_date IS NULL) simultaneamente. Defensa en profundidad
--    sobre la validacion en capa de aplicacion.
CREATE OR REPLACE FUNCTION "fn_enforce_single_active_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$BEGIN
  IF NEW."end_date" IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM "ownership_records"
      WHERE "piece_id" = NEW."piece_id"
        AND "end_date" IS NULL
        AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'piece_already_has_active_owner'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_enforce_single_active_owner"
  BEFORE INSERT ON "ownership_records"
  FOR EACH ROW
  EXECUTE FUNCTION "fn_enforce_single_active_owner"();
-- 3) Rango de fechas valido en la propiedad.
--    Un registro historico no puede terminar antes de comenzar.
ALTER TABLE "ownership_records"
  ADD CONSTRAINT "chk_ownership_date_range"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");