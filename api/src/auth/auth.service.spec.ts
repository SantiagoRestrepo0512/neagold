import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { argon2id, hash } from 'argon2'
import { createHash } from 'node:crypto'
import { AuthService } from './auth.service'
import { AuditService } from '../audit/audit.service'
import { EnvConfig } from '../config/env.validation'
import { EmailProvider } from '../email/email-provider'
import { MfaService } from '../mfa/mfa.service'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const CLIENT_IP = '203.0.113.10'
const CLIENT_UA = 'vitest-unit/1.0'

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService<EnvConfig, true> {
  const values: Record<string, unknown> = {
    nodeEnv: 'test',
    jwtAccessTtlSeconds: 900,
    sessionTtlDays: 30,
    jwtIssuer: 'neagold',
    jwtAudience: 'neagold-web',
    ...overrides
  }
  return new ConfigService(values) as unknown as ConfigService<EnvConfig, true>
}

type Mock = ReturnType<typeof vi.fn>

interface ModelMock {
  findUnique: Mock
  create: Mock
  update: Mock
  updateMany: Mock
  upsert: Mock
  deleteMany: Mock
  count: Mock
}

interface PrismaMock {
  users: ModelMock
  email_verification_tokens: ModelMock
  password_reset_tokens: ModelMock
  sessions: ModelMock
  login_attempts: ModelMock
  mfa: ModelMock
  $transaction: Mock
}

function makePrisma(): PrismaMock {
  const delegate = (): ModelMock => ({
    findUnique: vi.fn((args: unknown) => args),
    create: vi.fn((args: unknown) => args),
    update: vi.fn((args: unknown) => args),
    updateMany: vi.fn((_args: unknown) => ({ count: 1 })),
    upsert: vi.fn((args: unknown) => args),
    deleteMany: vi.fn((_args: unknown) => ({ count: 1 })),
    count: vi.fn(() => 0)
  })

  return {
    users: delegate(),
    email_verification_tokens: delegate(),
    password_reset_tokens: delegate(),
    sessions: delegate(),
    login_attempts: delegate(),
    mfa: delegate(),
    $transaction: vi.fn((_args: unknown[]) => Promise.all(_args))
  }
}

const audit = {
  record: vi.fn()
} as never as AuditService

const jwt = {
  sign: vi.fn(() => 'signed-access-token')
} as never as JwtService

const email = {
  kind: 'dev',
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn()
} as never as EmailProvider

const mfaService = {
  createChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  recoverChallenge: vi.fn()
} as never as MfaService

const VALID_PASSWORD = 'Str0ng!Passw0rd'

const ACTIVE_USER = {
  id: 'u1',
  email: 'a@test.local',
  status: 'ACTIVE'
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof makePrisma>

  beforeEach(() => {
    vi.clearAllMocks()
    prisma = makePrisma()
    mfaService.createChallenge.mockResolvedValue({ token: 'challenge-token' })
    mfaService.verifyChallenge.mockResolvedValue('u1')
  })

  const makeService = (): AuthService =>
    new AuthService(prisma as never, jwt, audit, mfaService, email, makeConfig())

  const hashPassword = (): Promise<string> =>
    hash(VALID_PASSWORD, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })

  describe('register', () => {
    it('rechaza email duplicado', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 'existing' })
      const service = makeService()
      await expect(
        service.register({
          email: 'dup@test.local',
          password: VALID_PASSWORD,
          firstName: 'A',
          lastName: 'B'
        })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('crea el usuario con hash Argon2id, token de verificación y envío de email', async () => {
      prisma.users.findUnique.mockResolvedValue(null)
      prisma.users.create.mockResolvedValue({ id: 'u1', email: 'a@test.local' })
      prisma.email_verification_tokens.create.mockResolvedValue({})
      const service = makeService()

      const result = await service.register({
        email: 'a@test.local',
        password: VALID_PASSWORD,
        firstName: 'Ana',
        lastName: 'Pérez'
      })

      const created = prisma.users.create.mock.calls[0][0]
      expect(created.data.passwordHash).toMatch(/^\$argon2id/)
      expect(created.data.passwordHash).not.toContain(VALID_PASSWORD)
      expect(created.data.status).toBe('PENDING_VERIFICATION')
      expect(prisma.email_verification_tokens.create).toHaveBeenCalled()
      // El token viaja hasheado; el proveedor dev solo recibe el crudo
      const tokenCall = prisma.email_verification_tokens.create.mock.calls[0][0]
      const emailCall = email.sendVerificationEmail.mock.calls[0][0]
      expect(tokenCall.data.tokenHash).toBe(sha256(emailCall.token))
      expect(emailCall.to).toBe('a@test.local')
      // En dev/test el proveedor dev expone el link local
      expect(result.devVerifyUrl).toBe(
        `http://localhost:3000/api/v1/auth/verify-email/${emailCall.token}`
      )
    })
  })

  describe('login', () => {
    it('rechaza contraseña incorrecta con mensaje genérico y registra el fallo', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        passwordHash: await hashPassword(),
        lockedUntil: null
      })
      const service = makeService()
      await expect(
        service.login('a@test.local', 'Wrong!Password1', CLIENT_IP, CLIENT_UA)
      ).rejects.toBeInstanceOf(UnauthorizedException)

      // Primera vez desde esa IP: ventana nueva (upsert con create)
      const upsert = prisma.login_attempts.upsert.mock.calls[0][0]
      expect(upsert.where).toEqual({ email_ipAddress: { email: 'a@test.local', ipAddress: CLIENT_IP } })
      expect(upsert.create.failedCount).toBe(1)
      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { failedLoginAttempts: { increment: 1 } }
        })
      )
    })

    it('devuelve el mismo error para usuario inexistente (anti-enumeración)', async () => {
      prisma.users.findUnique.mockResolvedValue(null)
      const service = makeService()
      await expect(
        service.login('nobody@test.local', VALID_PASSWORD, CLIENT_IP, CLIENT_UA)
      ).rejects.toBeInstanceOf(UnauthorizedException)
      // Sin usuario no hay fallo que registrar
      expect(prisma.login_attempts.upsert).not.toHaveBeenCalled()
    })

    it('no bloquea la cuenta por fallos desde una sola IP (anti lockout DoS)', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        passwordHash: await hashPassword(),
        lockedUntil: null
      })
      prisma.login_attempts.findUnique.mockResolvedValue({
        id: 'l1',
        windowStartedAt: new Date(Date.now() - 60_000)
      })
      prisma.users.update.mockResolvedValue({ failedLoginAttempts: 5 })
      prisma.login_attempts.count.mockResolvedValue(1)

      const service = makeService()
      await expect(
        service.login('a@test.local', 'Wrong!Password1', CLIENT_IP, CLIENT_UA)
      ).rejects.toBeInstanceOf(UnauthorizedException)

      // Se incrementa la ventana (email, IP) pero nunca se bloquea la cuenta
      expect(prisma.login_attempts.update).toHaveBeenCalled()
      const lockUpdates = prisma.users.update.mock.calls.filter(
        (call: Array<{ data?: { lockedUntil?: unknown } }>) => call[0]?.data?.lockedUntil
      )
      expect(lockUpdates.length).toBe(0)
    })

    it('bloquea la cuenta tras 5 fallos desde 2+ IPs distintas', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        passwordHash: await hashPassword(),
        lockedUntil: null
      })
      prisma.login_attempts.findUnique.mockResolvedValue({
        id: 'l1',
        windowStartedAt: new Date(Date.now() - 60_000)
      })
      prisma.users.update.mockResolvedValue({ failedLoginAttempts: 5 })
      prisma.login_attempts.count.mockResolvedValue(2)

      const service = makeService()
      await expect(
        service.login('a@test.local', 'Wrong!Password1', '198.51.100.7', CLIENT_UA)
      ).rejects.toBeInstanceOf(UnauthorizedException)

      const lockUpdates = prisma.users.update.mock.calls.filter(
        (call: Array<{ data?: { lockedUntil?: unknown } }>) => call[0]?.data?.lockedUntil
      )
      expect(lockUpdates.length).toBe(1)
      expect(lockUpdates[0][0].data.lockedUntil).toBeInstanceOf(Date)
    })

    it('rechaza login sin email verificado', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 'u1',
        passwordHash: await hashPassword(),
        lockedUntil: null,
        status: 'PENDING_VERIFICATION'
      })
      const service = makeService()
      await expect(
        service.login('a@test.local', VALID_PASSWORD, CLIENT_IP, CLIENT_UA)
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('inicia sesión correctamente y emite access + refresh', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        passwordHash: await hashPassword(),
        lockedUntil: null,
        userRoles: [
          {
            role: {
              rolePermissions: [
                { permission: { code: 'pieces:read_own' } },
                { permission: { code: 'transfers:request' } }
              ]
            }
          }
        ]
      })
      prisma.users.update.mockResolvedValue({})
      prisma.mfa.findUnique.mockResolvedValue(null)
      prisma.sessions.create.mockResolvedValue({
        id: 's1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 100000)
      })

      const service = makeService()
      const result = await service.login('a@test.local', VALID_PASSWORD, CLIENT_IP, CLIENT_UA)

      expect(result.mfaRequired).toBe(false)
      if (!result.mfaRequired) {
        expect(result.accessToken).toBe('signed-access-token')
        expect(result.refreshToken).toBeTruthy()
        // El hash guardado es sha256 del token, nunca el token crudo
        expect(prisma.sessions.create.mock.calls[0][0].data.refreshTokenHash).toBe(
          sha256(result.refreshToken)
        )
        // M1: la sesión registra IP y user-agent del login
        expect(prisma.sessions.create.mock.calls[0][0].data.ipAddress).toBe(CLIENT_IP)
        expect(prisma.sessions.create.mock.calls[0][0].data.userAgent).toBe(CLIENT_UA)
      }
      // Reset del contador y de la ventana de intentos tras éxito
      const update = prisma.users.update.mock.calls[0][0]
      expect(update.data.failedLoginAttempts).toBe(0)
      expect(prisma.login_attempts.deleteMany).toHaveBeenCalledWith({
        where: { email: 'a@test.local' }
      })
    })

    it('exige MFA y emite un desafío de un solo uso en lugar de cookies', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        passwordHash: await hashPassword(),
        lockedUntil: null
      })
      prisma.mfa.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' })

      const service = makeService()
      const result = await service.login('a@test.local', VALID_PASSWORD, CLIENT_IP, CLIENT_UA)

      expect(result.mfaRequired).toBe(true)
      if (result.mfaRequired) {
        expect(result.challengeToken).toBe('challenge-token')
      }
      expect(prisma.sessions.create).not.toHaveBeenCalled()
      expect(mfaService.createChallenge).toHaveBeenCalledWith('u1')
    })

    it('completa el login tras validar el desafío MFA', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...ACTIVE_USER,
        userRoles: []
      })
      prisma.users.update.mockResolvedValue({})
      prisma.mfa.findUnique.mockResolvedValue(null)
      prisma.sessions.create.mockResolvedValue({
        id: 's1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 100000)
      })

      const service = makeService()
      const result = await service.verifyMfaChallenge('challenge-token', '123456', CLIENT_IP, CLIENT_UA)

      expect(result.mfaRequired).toBe(false)
      if (!result.mfaRequired) {
        expect(result.refreshToken).toBeTruthy()
        expect(result.accessToken).toBe('signed-access-token')
      }
      expect(mfaService.verifyChallenge).toHaveBeenCalledWith('challenge-token', '123456')
      expect(prisma.sessions.create.mock.calls[0][0].data.ipAddress).toBe(CLIENT_IP)
    })
  })

  describe('refresh', () => {
    it('rota el refresh token y revoca el anterior', async () => {
      const refreshToken = 'rotating-token-value'
      prisma.sessions.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null
      })
      prisma.users.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@test.local',
        status: 'ACTIVE',
        userRoles: []
      })

      const service = makeService()
      const result = await service.refresh(refreshToken, CLIENT_IP, CLIENT_UA)

      expect(result.refreshToken).not.toBe(refreshToken)
      const ops = prisma.$transaction.mock.calls[0][0] as Array<{
        data: { revokedAt?: unknown; familyId?: unknown; refreshTokenHash?: unknown; ipAddress?: unknown }
      }>
      expect(ops[0].data.revokedAt).toBeInstanceOf(Date)
      expect(ops[1].data.familyId).toBe('fam-1')
      expect(ops[1].data.refreshTokenHash).toBe(sha256(result.refreshToken))
      // M1: la sesión rotada registra la IP del refresh
      expect(ops[1].data.ipAddress).toBe(CLIENT_IP)
    })

    it('revoca toda la familia cuando se reusa un token ya rotado', async () => {
      prisma.sessions.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date()
      })
      prisma.sessions.updateMany.mockResolvedValue({ count: 2 })

      const service = makeService()
      await expect(service.refresh('stale-token', CLIENT_IP, CLIENT_UA)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(prisma.sessions.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      })
    })

    it('rechaza sesión expirada', async () => {
      prisma.sessions.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null
      })
      const service = makeService()
      await expect(service.refresh('expired-token', CLIENT_IP, CLIENT_UA)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('rechaza token desconocido', async () => {
      prisma.sessions.findUnique.mockResolvedValue(null)
      const service = makeService()
      await expect(service.refresh('unknown-token', CLIENT_IP, CLIENT_UA)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })
  })

  describe('resetPassword', () => {
    it('rechaza token ya utilizado', async () => {
      prisma.password_reset_tokens.findUnique.mockResolvedValue({ usedAt: new Date() })
      const service = makeService()
      await expect(service.resetPassword('token', VALID_PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('rechaza token expirado', async () => {
      prisma.password_reset_tokens.findUnique.mockResolvedValue({
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000)
      })
      const service = makeService()
      await expect(service.resetPassword('token', VALID_PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('cambia el hash y revoca todas las sesiones', async () => {
      prisma.password_reset_tokens.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 100000)
      })

      const service = makeService()
      const result = await service.resetPassword('valid-token-here', VALID_PASSWORD)

      expect(result.reset).toBe(true)
      const ops = prisma.$transaction.mock.calls[0][0]
      const userUpdate = ops.find(
        (op: { data?: unknown }) =>
          (op as { data?: { passwordHash?: string } })?.data?.passwordHash
      )
      expect((userUpdate as { data: { passwordHash: string } }).data.passwordHash).toMatch(
        /^\$argon2id/
      )
      expect(prisma.sessions.updateMany).toHaveBeenCalled()
    })
  })
})