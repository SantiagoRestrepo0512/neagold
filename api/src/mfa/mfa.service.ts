import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { EnvConfig } from '../config/env.validation'
import { PrismaService } from '../prisma/prisma.service'
import { AuditAction, AuditService } from '../audit/audit.service'
import {
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp
} from './totp'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_CHALLENGE_ATTEMPTS = 5

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function encryptSecret(keyHex: string, plaintext: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptSecret(keyHex: string, payload: string): string {
  const [version, ivHex, tagHex, cipherHex] = payload.split(':')
  if (version !== 'v1') throw new Error('Formato de secreto cifrado no soportado')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()])
  return decrypted.toString('utf8')
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name)
  private readonly encryptionKey: string
  private readonly issuer: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<EnvConfig, true>
  ) {
    this.encryptionKey = config.get('mfaSecretEncryptionKey', { infer: true })
    this.issuer = config.get('totpIssuer', { infer: true })
  }

  // ------------------------------------------------------------------ setup

  async status(userId: string): Promise<{ enabled: boolean }> {
    const record = await this.prisma.mfa.findUnique({ where: { userId } })
    return { enabled: record !== null }
  }

  /** Genera un secreto nuevo. El usuario debe probar posesión (verify-setup)
   *  antes de que se persista. */
  async setup(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
    const existing = await this.prisma.mfa.findUnique({ where: { userId } })
    if (existing) {
      throw new ConflictException('MFA ya configurado')
    }
    const secret = generateTotpSecret()
    return { secret, otpauthUrl: otpauthUrl(this.issuer, email, secret) }
  }

  /** Activa MFA: valida un código TOTP contra el secreto aportado, lo persiste
   *  cifrado y devuelve los códigos de recuperación (solo se muestran una vez;
   *  se guardan hasheados). */
  async verifySetup(
    userId: string,
    secret: string,
    code: string
  ): Promise<{ recoveryCodes: string[] }> {
    const existing = await this.prisma.mfa.findUnique({ where: { userId } })
    if (existing) {
      throw new ConflictException('MFA ya configurado')
    }
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Código de verificación inválido')
    }

    const recoveryCodes = generateRecoveryCodes(10)
    await this.prisma.$transaction([
      this.prisma.mfa.create({
        data: {
          userId,
          secretEncrypted: encryptSecret(this.encryptionKey, secret),
          recoveryCodes: recoveryCodes.map((code) => sha256(code))
        }
      }),
      this.prisma.users.update({
        where: { id: userId },
        data: { authStage: 'MFA_VERIFIED' }
      })
    ])

    this.audit.record(userId, {
      action: AuditAction.MFA_ENABLED,
      entityType: 'user',
      entityId: userId
    })
    this.logger.log(`MFA TOTP habilitado para el usuario ${userId}`)

    return { recoveryCodes }
  }

  async disable(userId: string, code: string): Promise<{ disabled: boolean }> {
    const record = await this.prisma.mfa.findUnique({ where: { userId } })
    if (!record) {
      throw new ConflictException('MFA no configurado')
    }
    const secret = decryptSecret(this.encryptionKey, record.secretEncrypted)
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Código de verificación inválido')
    }

    await this.prisma.$transaction([
      this.prisma.mfa.delete({ where: { userId } }),
      this.prisma.users.update({
        where: { id: userId },
        data: { authStage: 'NONE' }
      })
    ])

    this.audit.record(userId, {
      action: AuditAction.MFA_DISABLED,
      entityType: 'user',
      entityId: userId
    })
    return { disabled: true }
  }

  // ------------------------------------------------------------------ challenge

  /** Crea un desafío de un solo uso de 5 minutos para completar el login. */
  async createChallenge(userId: string): Promise<{ token: string }> {
    const token = randomUUID().replace(/-/g, '') + randomBytes(24).toString('hex')
    await this.prisma.mfa_challenges.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS)
      }
    })
    return { token }
  }

  private async loadValidChallenge(
    token: string
  ): Promise<{ id: string; userId: string; attempts: number }> {
    const challenge = await this.prisma.mfa_challenges.findUnique({
      where: { tokenHash: sha256(token) }
    })
    if (!challenge || challenge.usedAt !== null || challenge.revokedAt !== null) {
      throw new UnauthorizedException('Desafío inválido o ya utilizado')
    }
    if (challenge.expiresAt < new Date()) {
      throw new UnauthorizedException('Desafío expirado')
    }
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      throw new UnauthorizedException('Demasiados intentos, vuelve a iniciar sesión')
    }
    return challenge
  }

  /** Valida el código TOTP del desafío. Devuelve el userId si es correcto. */
  async verifyChallenge(token: string, code: string): Promise<string> {
    const challenge = await this.loadValidChallenge(token)
    const record = await this.prisma.mfa.findUnique({ where: { userId: challenge.userId } })
    if (!record) {
      throw new UnauthorizedException('MFA no configurado')
    }

    const secret = decryptSecret(this.encryptionKey, record.secretEncrypted)
    if (!verifyTotp(secret, code)) {
      await this.registerFailedAttempt(challenge)
      this.audit.record(challenge.userId, {
        action: AuditAction.MFA_FAILED,
        entityType: 'user',
        entityId: challenge.userId
      })
      throw new UnauthorizedException('Código incorrecto')
    }

    await this.prisma.$transaction([
      this.prisma.mfa_challenges.update({
        where: { id: challenge.id },
        data: { usedAt: new Date() }
      }),
      this.prisma.mfa.update({
        where: { userId: challenge.userId },
        data: { lastVerifiedAt: new Date() }
      })
    ])

    this.audit.record(challenge.userId, {
      action: AuditAction.MFA_VERIFIED,
      entityType: 'user',
      entityId: challenge.userId
    })
    return challenge.userId
  }

  /** Valida un código de recuperación del desafío (se consume al usarlo). */
  async recoverChallenge(token: string, recoveryCode: string): Promise<string> {
    const challenge = await this.loadValidChallenge(token)
    const record = await this.prisma.mfa.findUnique({ where: { userId: challenge.userId } })
    if (!record) {
      throw new UnauthorizedException('MFA no configurado')
    }

    const codeHash = sha256(recoveryCode.trim().toUpperCase())
    const index = record.recoveryCodes.indexOf(codeHash)
    if (index === -1) {
      await this.registerFailedAttempt(challenge)
      this.audit.record(challenge.userId, {
        action: AuditAction.MFA_FAILED,
        entityType: 'user',
        entityId: challenge.userId,
        metadata: { method: 'recovery_code' }
      })
      throw new UnauthorizedException('Código de recuperación inválido')
    }

    const remaining = [...record.recoveryCodes]
    remaining.splice(index, 1)
    await this.prisma.$transaction([
      this.prisma.mfa_challenges.update({
        where: { id: challenge.id },
        data: { usedAt: new Date() }
      }),
      this.prisma.mfa.update({
        where: { userId: challenge.userId },
        data: { lastVerifiedAt: new Date(), recoveryCodes: remaining }
      })
    ])

    this.audit.record(challenge.userId, {
      action: AuditAction.MFA_RECOVERED,
      entityType: 'user',
      entityId: challenge.userId
    })
    return challenge.userId
  }

  private async registerFailedAttempt(challenge: {
    id: string
    attempts: number
  }): Promise<void> {
    const next = challenge.attempts + 1
    await this.prisma.mfa_challenges.update({
      where: { id: challenge.id },
      data: { attempts: next, ...(next >= MAX_CHALLENGE_ATTEMPTS ? { revokedAt: new Date() } : {}) }
    })
  }
}