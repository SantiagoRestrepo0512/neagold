import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'

export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  REGISTER = 'REGISTER',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  SESSION_FAMILY_REVOKED = 'SESSION_FAMILY_REVOKED',
  PRODUCT_CREATED = 'PRODUCT_CREATED',
  PRODUCT_UPDATED = 'PRODUCT_UPDATED',
  PIECE_REGISTERED = 'PIECE_REGISTERED',
  PIECE_STATUS_CHANGED = 'PIECE_STATUS_CHANGED',
  PIECE_RETIRED = 'PIECE_RETIRED',
  QR_REGENERATED = 'QR_REGENERATED',
  SALE_CREATED = 'SALE_CREATED',
  CLAIM_REDEEMED = 'CLAIM_REDEEMED',
  TRANSFER_REQUESTED = 'TRANSFER_REQUESTED',
  TRANSFER_ACCEPTED = 'TRANSFER_ACCEPTED',
  TRANSFER_REJECTED = 'TRANSFER_REJECTED',
  TRANSFER_CANCELLED = 'TRANSFER_CANCELLED',
  INCIDENT_REPORTED = 'INCIDENT_REPORTED',
  INCIDENT_REPORT_ADDED = 'INCIDENT_REPORT_ADDED',
  INCIDENT_REVIEWED = 'INCIDENT_REVIEWED',
  INCIDENT_RECOVERED = 'INCIDENT_RECOVERED',
  INCIDENT_RESOLVED = 'INCIDENT_RESOLVED',
  WEBHOOK_CREATED = 'WEBHOOK_CREATED',
  WEBHOOK_UPDATED = 'WEBHOOK_UPDATED',
  WEBHOOK_SECRET_ROTATED = 'WEBHOOK_SECRET_ROTATED',
  WEBHOOK_DELETED = 'WEBHOOK_DELETED',
  CERTIFICATE_ISSUED = 'CERTIFICATE_ISSUED',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  SERVICE_CREATED = 'SERVICE_CREATED',
  SERVICE_COMPLETED = 'SERVICE_COMPLETED',
  SERVICE_CANCELLED = 'SERVICE_CANCELLED',
  MFA_ENABLED = 'MFA_ENABLED',
  MFA_DISABLED = 'MFA_DISABLED',
  MFA_VERIFIED = 'MFA_VERIFIED',
  MFA_FAILED = 'MFA_FAILED',
  MFA_RECOVERED = 'MFA_RECOVERED'
}

export interface AuditRecord {
  action: AuditAction | string
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
}

/**
 * Auditoría con formato estandarizado.
 * Nunca registrar: contraseñas, tokens, cookies ni datos personales.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REQUEST) private readonly request?: Request
  ) {}

  record(actorId: string | null | undefined, entry: AuditRecord): void {
    const r = this.request as (Request & { ip?: string }) | undefined

    void this.prisma.audit_logs
      .create({
        data: {
          actorId: actorId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? 'system',
          entityId: entry.entityId ?? null,
          ipAddress: r?.ip ?? null,
          userAgent: (r?.headers['user-agent'] as string) || null,
          metadata: (entry.metadata ?? {}) as object
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`Fallo al registrar auditoría (${entry.action}): ${String(error)}`)
      })
  }
}