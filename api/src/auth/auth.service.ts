import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UserStatus } from '@prisma/client'
import { argon2id, hash, verify } from 'argon2'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { EnvConfig } from '../config/env.validation'
import { PrismaService } from '../prisma/prisma.service'
import { AuditAction, AuditService } from '../audit/audit.service'
import { EMAIL_PROVIDER, EmailProvider } from '../email/email-provider'
import { MfaService } from '../mfa/mfa.service'
import { JwtPayload } from './strategies/jwt.strategy'
import { RegisterDto } from './dto/register.dto'

const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000
const ESCALATED_LOCKOUT_THRESHOLD = 8
const ESCALATED_LOCKOUT_MS = 60 * 60 * 1000
const SEVERE_LOCKOUT_THRESHOLD = 10
const SEVERE_LOCKOUT_MS = 24 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000

/** Hash de una contraseña falsa: iguala el tiempo de respuesta cuando el
 *  email no existe (anti-enumeración por timing). */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$MlP7TdgMZM1nx2QwJ2qFEA$4F6Ol+wYS0OFMGbhoxhyGl3jyfzabVHZoVqAlco0t2U'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const generateRefreshToken = (): string => randomBytes(48).toString('base64url')
const newOpaqueToken = (): string => randomBytes(32).toString('hex')
const nowPlus = (ms: number): Date => new Date(Date.now() + ms)

interface UserWithPermissions {
  id: string
  email: string
  status: UserStatus
  permissions: string[]
}

export type LoginResult =
  | {
      mfaRequired: true
      challengeToken: string
      user: { id: string; email: string }
    }
  | {
      mfaRequired: false
      user: { id: string; email: string }
      accessToken: string
      refreshToken: string
    }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly nodeEnv: string
  private readonly accessTtlSeconds: number
  private readonly sessionTtlMs: number
  private readonly jwtIssuer: string
  private readonly jwtAudience: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mfaService: MfaService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    config: ConfigService<EnvConfig, true>
  ) {
    this.nodeEnv = config.get('nodeEnv', { infer: true })
    this.accessTtlSeconds = config.get('jwtAccessTtlSeconds', { infer: true })
    this.sessionTtlMs =
      config.get('sessionTtlDays', { infer: true }) * 24 * 60 * 60 * 1000
    this.jwtIssuer = config.get('jwtIssuer', { infer: true })
    this.jwtAudience = config.get('jwtAudience', { infer: true })
  }

  // ------------------------------------------------------------------ utils

  private async loadPermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } }
          }
        }
      }
    })
    if (!user) return []
    const permissions = new Set<string>()
    for (const { role } of user.userRoles) {
      for (const { permission } of role.rolePermissions) {
        permissions.add(permission.code)
      }
    }
    return [...permissions]
  }

  private async issueAccessToken(user: UserWithPermissions): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      permissions: user.permissions
    }
    return this.jwt.sign(payload, {
      expiresIn: this.accessTtlSeconds,
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
      jwtid: randomUUID()
    })
  }

  private devLink(path: string, token: string): string | undefined {
    if (this.email.kind !== 'dev') return undefined
    if (this.nodeEnv !== 'development' && this.nodeEnv !== 'test') return undefined
    return `http://localhost:3000/api/v1/auth${path}/${token}`
  }

  // ------------------------------------------------------------------ register

  async register(dto: RegisterDto) {
    const existing = await this.prisma.users.findUnique({ where: { email: dto.email } })
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con este email')
    }

    const passwordHash = await hash(dto.password, ARGON2_OPTIONS)
    const token = newOpaqueToken()

    const user = await this.prisma.users.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        status: 'PENDING_VERIFICATION'
      }
    })
    await this.prisma.email_verification_tokens.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: nowPlus(24 * 60 * 60 * 1000)
      }
    })
    await this.email.sendVerificationEmail({ to: user.email, token })

    this.audit.record(user.id, { action: AuditAction.REGISTER, entityType: 'user', entityId: user.id })
    this.logger.log(`Usuario registrado: ${user.email}`)

    return {
      id: user.id,
      email: user.email,
      devVerifyUrl: this.devLink('/verify-email', token)
    }
  }

  async resendVerification(email: string) {
    const user = await this.prisma.users.findUnique({ where: { email } })
    if (!user || user.status !== 'PENDING_VERIFICATION') {
      // Respuesta genérica: no revelar si el email existe
      return { sent: true }
    }
    const token = newOpaqueToken()
    await this.prisma.email_verification_tokens.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: nowPlus(24 * 60 * 60 * 1000)
      }
    })
    await this.email.sendVerificationEmail({ to: user.email, token })
    return { sent: true, devVerifyUrl: this.devLink('/verify-email', token) }
  }

  async verifyEmail(token: string) {
    const tokenHash = sha256(token)
    const record = await this.prisma.email_verification_tokens.findUnique({
      where: { tokenHash }
    })
    if (!record || record.usedAt !== null) {
      throw new UnauthorizedException('Token de verificación inválido o ya utilizado')
    }
    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de verificación expirado')
    }

    await this.prisma.$transaction([
      this.prisma.email_verification_tokens.update({
        where: { id: record.id },
        data: { usedAt: new Date() }
      }),
      this.prisma.users.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          status: 'ACTIVE'
        }
      })
    ])

    this.audit.record(record.userId, {
      action: AuditAction.EMAIL_VERIFIED,
      entityType: 'user',
      entityId: record.userId
    })
    return { verified: true }
  }

  // ------------------------------------------------------------------ login

  async login(email: string, password: string, ip: string, userAgent: string | undefined): Promise<LoginResult> {
    const user = await this.prisma.users.findUnique({ where: { email } })

    // Respuesta genérica y timing constante: si el email no existe se verifica
    // contra un hash dummy para no revelar su existencia por tiempo de respuesta.
    const passwordOk = user
      ? await verify(user.passwordHash, password).catch(() => false)
      : await verify(DUMMY_PASSWORD_HASH, password).catch(() => false)
    if (!user || !passwordOk) {
      if (user) await this.recordFailedLogin(email, user.id, ip)
      throw new UnauthorizedException('Credenciales inválidas')
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException({
        statusCode: 423,
        code: 'ACCOUNT_LOCKED',
        message: 'Cuenta bloqueada temporalmente por intentos fallidos'
      })
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verifica tu email antes de iniciar sesión'
      })
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Cuenta deshabilitada')
    }

    const mfa = await this.prisma.mfa.findUnique({ where: { userId: user.id } })
    if (mfa) {
      // Paso 1 de 2: la contraseña es correcta pero falta el segundo factor.
      // Se emite un desafío de un solo uso; la sesión se crea al validarlo.
      const challenge = await this.mfaService.createChallenge(user.id)
      this.audit.record(user.id, {
        action: AuditAction.LOGIN,
        entityType: 'user',
        entityId: user.id,
        metadata: { mfaRequired: true }
      })
      return {
        mfaRequired: true,
        challengeToken: challenge.token,
        user: { id: user.id, email: user.email }
      }
    }

    return this.completeLogin(user.id, email, ip, userAgent)
  }

  private async completeLogin(
    userId: string,
    email: string,
    ip: string,
    userAgent: string | undefined
  ): Promise<Extract<LoginResult, { mfaRequired: false }>> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }
    })
    // Un login exitoso limpia la ventana de intentos de ese email.
    await this.prisma.login_attempts.deleteMany({ where: { email } })

    const permissions = await this.loadPermissions(userId)
    const session = await this.createSession(userId, ip, userAgent)
    this.audit.record(userId, {
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: userId
    })

    return {
      mfaRequired: false,
      user: { id: userId, email },
      accessToken: await this.issueAccessToken({ id: userId, email, status: 'ACTIVE', permissions }),
      refreshToken: session.refreshToken
    }
  }

  async verifyMfaChallenge(
    challengeToken: string,
    code: string,
    ip: string,
    userAgent: string | undefined
  ) {
    const userId = await this.mfaService.verifyChallenge(challengeToken, code)
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true }
    })
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sesión inválida')
    }
    return this.completeLogin(user.id, user.email, ip, userAgent)
  }

  async recoverMfaChallenge(
    challengeToken: string,
    recoveryCode: string,
    ip: string,
    userAgent: string | undefined
  ) {
    const userId = await this.mfaService.recoverChallenge(challengeToken, recoveryCode)
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true }
    })
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sesión inválida')
    }
    return this.completeLogin(user.id, user.email, ip, userAgent)
  }

  /**
   * Registra un intento fallido en la ventana de (email, IP) y en el contador
   * de la cuenta. Mitigación de lockout DoS: una sola IP (ataque de brute
   * force, que ya está limitado por throttle) NO puede bloquear la cuenta;
   * el lockout escalonado solo se activa cuando los fallos vienen de 2+ IPs
   * distintas en la ventana (ataque distribuido o error real del propietario).
   */
  private async recordFailedLogin(email: string, userId: string, ip: string): Promise<void> {
    const windowStart = new Date(Date.now() - LOGIN_WINDOW_MS)

    const existing = await this.prisma.login_attempts.findUnique({
      where: { email_ipAddress: { email, ipAddress: ip } }
    })
    if (existing && existing.windowStartedAt >= windowStart) {
      await this.prisma.login_attempts.update({
        where: { id: existing.id },
        data: { failedCount: { increment: 1 } }
      })
    } else {
      await this.prisma.login_attempts.upsert({
        where: { email_ipAddress: { email, ipAddress: ip } },
        create: { email, ipAddress: ip, failedCount: 1, windowStartedAt: new Date() },
        update: { failedCount: 1, windowStartedAt: new Date() }
      })
    }

    const user = await this.prisma.users.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } }
    })

    const distinctIps = await this.prisma.login_attempts.count({
      where: { email, windowStartedAt: { gte: windowStart } }
    })
    if (distinctIps < 2) return

    // Lockout escalonado: 5 fallos → 15 min; 8 → 1 h; 10 → 24 h.
    const attempt = user.failedLoginAttempts
    const lock: { durationMs: number } | null =
      attempt === MAX_FAILED_ATTEMPTS
        ? { durationMs: LOCKOUT_MS }
        : attempt === ESCALATED_LOCKOUT_THRESHOLD
          ? { durationMs: ESCALATED_LOCKOUT_MS }
          : attempt === SEVERE_LOCKOUT_THRESHOLD
            ? { durationMs: SEVERE_LOCKOUT_MS }
            : null
    if (!lock) return

    await this.prisma.users.update({
      where: { id: userId },
      data: { lockedUntil: nowPlus(lock.durationMs) }
    })
    this.audit.record(userId, {
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: userId,
      metadata: { result: 'locked', durationMs: lock.durationMs, distinctIps }
    })
  }

  async createSession(
    userId: string,
    ip?: string,
    userAgent?: string
  ): Promise<{ refreshToken: string; familyId: string; expiresAt: Date }> {
    const refreshToken = generateRefreshToken()
    const session = await this.prisma.sessions.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        ipAddress: ip ?? null,
        userAgent: userAgent ? userAgent.slice(0, 255) : null,
        expiresAt: nowPlus(this.sessionTtlMs)
      }
    })
    return { refreshToken, familyId: session.familyId, expiresAt: session.expiresAt }
  }

  // ------------------------------------------------------------------ refresh

  async refresh(refreshToken: string, ip: string, userAgent: string | undefined) {
    const tokenHash = sha256(refreshToken)
    const session = await this.prisma.sessions.findUnique({ where: { refreshTokenHash: tokenHash } })
    if (!session) {
      throw new UnauthorizedException('Sesión inválida')
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión expirada')
    }
    if (session.revokedAt !== null) {
      // Reuso de un token ya rotado: posible robo -> revocar toda la familia
      await this.prisma.sessions.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() }
      })
      this.audit.record(session.userId, {
        action: AuditAction.SESSION_FAMILY_REVOKED,
        entityType: 'user',
        entityId: session.userId,
        metadata: { reason: 'refresh_token_reuse' }
      })
      throw new UnauthorizedException('Sesión comprometida, cierra sesión e inicia de nuevo')
    }

    const user = await this.prisma.users.findUnique({ where: { id: session.userId } })
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sesión inválida')
    }

    const rotatedToken = generateRefreshToken()
    await this.prisma.$transaction([
      this.prisma.sessions.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() }
      }),
      this.prisma.sessions.create({
        data: {
          userId: session.userId,
          refreshTokenHash: sha256(rotatedToken),
          familyId: session.familyId,
          ipAddress: ip ?? null,
          userAgent: userAgent ? userAgent.slice(0, 255) : null,
          expiresAt: nowPlus(this.sessionTtlMs)
        }
      })
    ])

    const permissions = await this.loadPermissions(user.id)
    return {
      accessToken: await this.issueAccessToken({
        id: user.id,
        email: user.email,
        status: user.status,
        permissions
      }),
      refreshToken: rotatedToken
    }
  }

  // ------------------------------------------------------------------ logout

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return
    const session = await this.prisma.sessions.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) }
    })
    if (!session) return
    await this.prisma.sessions.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    })
    this.audit.record(session.userId, {
      action: AuditAction.LOGOUT,
      entityType: 'user',
      entityId: session.userId
    })
  }

  // ------------------------------------------------------------------ password reset

  async forgotPassword(email: string) {
    const user = await this.prisma.users.findUnique({ where: { email } })
    if (!user) {
      // Respuesta genérica en ambos casos
      return { sent: true }
    }
    const token = newOpaqueToken()
    await this.prisma.password_reset_tokens.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: nowPlus(60 * 60 * 1000) }
    })
    await this.email.sendPasswordResetEmail({ to: user.email, token })
    this.audit.record(user.id, {
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      entityType: 'user',
      entityId: user.id
    })
    return { sent: true, devResetUrl: this.devLink('/reset-password', token) }
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = sha256(token)
    const record = await this.prisma.password_reset_tokens.findUnique({ where: { tokenHash } })
    if (!record || record.usedAt !== null) {
      throw new UnauthorizedException('Token de restablecimiento inválido o ya utilizado')
    }
    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de restablecimiento expirado')
    }

    const passwordHash = await hash(newPassword, ARGON2_OPTIONS)
    await this.prisma.$transaction([
      this.prisma.password_reset_tokens.update({
        where: { id: record.id },
        data: { usedAt: new Date() }
      }),
      this.prisma.users.update({
        where: { id: record.userId },
        data: { passwordHash }
      }),
      this.prisma.sessions.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    ])

    this.audit.record(record.userId, {
      action: AuditAction.PASSWORD_RESET,
      entityType: 'user',
      entityId: record.userId
    })
    return { reset: true }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } })
    if (!user || !(await verify(user.passwordHash, currentPassword).catch(() => false))) {
      throw new UnauthorizedException('La contraseña actual es incorrecta')
    }
    const passwordHash = await hash(newPassword, ARGON2_OPTIONS)
    await this.prisma.users.update({ where: { id: userId }, data: { passwordHash } })
    // Un cambio de contraseña invalida las demás sesiones
    await this.prisma.sessions.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
    this.audit.record(userId, {
      action: AuditAction.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: userId
    })
    return { changed: true }
  }
}