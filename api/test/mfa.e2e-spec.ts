import 'reflect-metadata'
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { argon2id, hash } from 'argon2'
import { createDecipheriv, createHash } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../dist/app.module'
import { prisma, truncateAll } from '../../prisma/tests/helpers'
import { totpFor } from '../dist/mfa/totp'
import { listenForTests } from './test-server'

const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD = 'Str0ng!Passw0rd'

const cookieValue = (setCookie: string[], name: string): string => {
  const match = setCookie.join(';').match(new RegExp(`${name}=([^;]+)`))
  if (!match) throw new Error(`Cookie ${name} no encontrada`)
  return match[1]
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Descifra un secreto cifrado con AES-256-GCM (formato v1:iv:tag:data). */
function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(':')
  if (version !== 'v1') throw new Error('Formato de secreto inesperado')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.MFA_SECRET_ENCRYPTION_KEY as string, 'hex'),
    Buffer.from(iv, 'hex')
  )
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString()
}

describe('API e2e (MFA TOTP)', () => {
  let app: INestApplication

  beforeAll(async () => {
    await truncateAll()
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.enableCors({ origin: ['http://localhost:5173'], credentials: true })
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready', 'verify/{*splat}'] })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
    await listenForTests(app)
  })

  afterAll(async () => {
    await app?.close()
  })

  async function makeAgent() {
    const agent = request.agent(app.getHttpServer())
    const csrf = await agent.get('/api/v1/auth/csrf')
    return { agent, csrfToken: csrf.body.csrfToken as string }
  }

  async function createActiveUser(email: string) {
    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const user = await prisma.users.create({
      data: {
        email,
        passwordHash,
        firstName: 'Mfa',
        lastName: 'User',
        status: 'ACTIVE'
      }
    })
    const role = await prisma.roles.findUnique({ where: { name: 'CUSTOMER' } })
    if (role) {
      await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })
    }
    return user
  }

  async function login(agent: ReturnType<typeof request.agent>, email: string) {
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    const res = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email, password: PASSWORD })
    return { csrf, res }
  }

  /** Login normal + enable MFA vía API. Devuelve agente autenticado con CSRF. */
  async function loginAndEnableMfa(email: string) {
    const agent = request.agent(app.getHttpServer())
    await login(agent, email)
    // El login rota la cookie de CSRF: volver a pedir un token fresco.
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    const setup = await agent
      .post('/api/v1/auth/mfa/setup')
      .set('x-csrf-token', csrf)
    const secret = setup.body.secret as string
    const verify = await agent
      .post('/api/v1/auth/mfa/verify-setup')
      .set('x-csrf-token', csrf)
      .send({ secret, code: totpFor(secret) })
    expect(verify.status).toBe(HttpStatus.OK)
    return { agent, csrf, secret, recoveryCodes: verify.body.recoveryCodes as string[] }
  }

  it('setup: genera secreto y otpauth URL; rechaza doble setup y peticiones sin sesión', async () => {
    const { agent, csrfToken } = await makeAgent()
    await createActiveUser('mfa-setup@test.local')
    const loginRes = await login(agent, 'mfa-setup@test.local')
    expect(loginRes.res.status).toBe(HttpStatus.OK)
    void csrfToken

    const anon = await agent.post('/api/v1/auth/mfa/setup')
    expect(anon.status).toBe(HttpStatus.FORBIDDEN)

    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    const noToken = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup')
      .set('x-csrf-token', csrf)
    expect(noToken.status).toBe(HttpStatus.UNAUTHORIZED)

    const setup = await agent.post('/api/v1/auth/mfa/setup').set('x-csrf-token', csrf)
    expect(setup.status).toBe(HttpStatus.OK)
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/')
    expect(setup.body.otpauthUrl).toContain(encodeURIComponent('NEAGOLD:mfa-setup@test.local'))

    const status = await agent.get('/api/v1/auth/mfa/status').set('x-csrf-token', csrf)
    expect(status.body.enabled).toBe(false)

    // setup no persiste: repetirlo antes de habilitar es inofensivo (200)
    const second = await agent.post('/api/v1/auth/mfa/setup').set('x-csrf-token', csrf)
    expect(second.status).toBe(HttpStatus.OK)
  })

  it('verify-setup: código incorrecto 401; correcto devuelve códigos y el secreto queda cifrado en reposo', async () => {
    const { agent } = await makeAgent()
    const user = await createActiveUser('mfa-enable@test.local')
    await login(agent, 'mfa-enable@test.local')
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string

    const setup = await agent.post('/api/v1/auth/mfa/setup').set('x-csrf-token', csrf)
    const secret = setup.body.secret as string

    const wrong = await agent
      .post('/api/v1/auth/mfa/verify-setup')
      .set('x-csrf-token', csrf)
      .send({ secret, code: '000000' })
    expect(wrong.status).toBe(HttpStatus.UNAUTHORIZED)

    const ok = await agent
      .post('/api/v1/auth/mfa/verify-setup')
      .set('x-csrf-token', csrf)
      .send({ secret, code: totpFor(secret) })
    expect(ok.status).toBe(HttpStatus.OK)
    expect(ok.body.recoveryCodes).toHaveLength(10)
    for (const code of ok.body.recoveryCodes as string[]) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    }

    const stored = await prisma.mfa.findUnique({ where: { userId: user.id } })
    expect(stored).not.toBeNull()
    expect(stored?.secretEncrypted.startsWith('v1:')).toBe(true)
    expect(stored?.secretEncrypted).not.toContain(secret)
    expect(stored?.recoveryCodes).toHaveLength(10)
    expect(stored?.recoveryCodes[0]).toHaveLength(64)

    const status = await agent.get('/api/v1/auth/mfa/status').set('x-csrf-token', csrf)
    expect(status.body.enabled).toBe(true)

    // Con MFA habilitado, un nuevo setup debe rechazarse (409)
    const conflict = await agent.post('/api/v1/auth/mfa/setup').set('x-csrf-token', csrf)
    expect(conflict.status).toBe(HttpStatus.CONFLICT)
  })

  it('login con MFA: primer paso sin cookies, challenge verifica TOTP y emite sesión (un solo uso)', async () => {
    await createActiveUser('mfa-login@test.local')
    const { agent } = await loginAndEnableMfa('mfa-login@test.local')

    const { csrf, res: first } = await login(agent, 'mfa-login@test.local')
    expect(first.status).toBe(HttpStatus.OK)
    expect(first.body.mfaRequired).toBe(true)
    expect(first.body.challengeToken).toBeTypeOf('string')
    expect(first.headers['set-cookie']).toBeUndefined()

    const stored = await prisma.mfa.findFirst({
      where: { user: { email: 'mfa-login@test.local' } },
      select: { secretEncrypted: true }
    })
    const plainSecret = decryptSecret(stored!.secretEncrypted)

    const wrong = await agent
      .post('/api/v1/auth/mfa/verify')
      .set('x-csrf-token', csrf)
      .send({ challengeToken: first.body.challengeToken, code: '000000' })
    expect(wrong.status).toBe(HttpStatus.UNAUTHORIZED)

    const ok = await agent
      .post('/api/v1/auth/mfa/verify')
      .set('x-csrf-token', csrf)
      .send({ challengeToken: first.body.challengeToken, code: totpFor(plainSecret) })
    expect(ok.status).toBe(HttpStatus.OK)
    const cookies = ok.headers['set-cookie'] as unknown as string[]
    expect(cookies.join(';')).toContain('ng_access=')
    expect(cookies.join(';')).toContain('ng_refresh=')
    const accessToken = cookieValue(cookies, 'ng_access')

    const me = await agent.get('/api/v1/users/me').set('Cookie', `ng_access=${accessToken}`)
    expect(me.status).toBe(HttpStatus.OK)
    expect(me.body.email).toBe('mfa-login@test.local')

    const reuse = await agent
      .post('/api/v1/auth/mfa/verify')
      .set('x-csrf-token', csrf)
      .send({ challengeToken: first.body.challengeToken, code: totpFor(plainSecret) })
    expect(reuse.status).toBe(HttpStatus.UNAUTHORIZED)

    const user = await prisma.users.findUnique({ where: { email: 'mfa-login@test.local' } })
    const challenge = await prisma.mfa_challenges.findFirst({ where: { userId: user!.id } })
    expect(challenge?.usedAt).not.toBeNull()
    expect(challenge?.attempts).toBe(1)
  })

  it('recover: código de recuperación completa el login y se consume (un solo uso)', async () => {
    await createActiveUser('mfa-recover-flow@test.local')
    const { agent, recoveryCodes } = await loginAndEnableMfa('mfa-recover-flow@test.local')

    const { csrf, res: first } = await login(agent, 'mfa-recover-flow@test.local')
    expect(first.body.mfaRequired).toBe(true)

    const wrong = await agent
      .post('/api/v1/auth/mfa/recover')
      .set('x-csrf-token', csrf)
      .send({ challengeToken: first.body.challengeToken, recoveryCode: 'AAAAAAAAAA' })
    expect(wrong.status).toBe(HttpStatus.UNAUTHORIZED)

    const issuedHash = sha256(recoveryCodes[0])
    const storedBefore = await prisma.mfa.findFirst({
      where: { user: { email: 'mfa-recover-flow@test.local' } },
      select: { recoveryCodes: true }
    })
    expect(storedBefore?.recoveryCodes).toContain(issuedHash)

    const ok = await agent
      .post('/api/v1/auth/mfa/recover')
      .set('x-csrf-token', csrf)
      .send({ challengeToken: first.body.challengeToken, recoveryCode: recoveryCodes[0] })
    expect(ok.status).toBe(HttpStatus.OK)
    expect(ok.headers['set-cookie']).toBeDefined()

    const storedAfter = await prisma.mfa.findFirst({
      where: { user: { email: 'mfa-recover-flow@test.local' } },
      select: { recoveryCodes: true }
    })
    expect(storedAfter?.recoveryCodes).toHaveLength(9)
    expect(storedAfter?.recoveryCodes).not.toContain(issuedHash)

    const secondLogin = await login(agent, 'mfa-recover-flow@test.local')
    const reuse = await agent
      .post('/api/v1/auth/mfa/recover')
      .set('x-csrf-token', secondLogin.csrf)
      .send({ challengeToken: secondLogin.res.body.challengeToken, recoveryCode: recoveryCodes[0] })
    expect(reuse.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('disable: requiere código TOTP y vuelve al login sin segundo factor', async () => {
    await createActiveUser('mfa-disable@test.local')
    const { agent, secret } = await loginAndEnableMfa('mfa-disable@test.local')
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string

    const wrong = await agent
      .post('/api/v1/auth/mfa/disable')
      .set('x-csrf-token', csrf)
      .send({ code: '000000' })
    expect(wrong.status).toBe(HttpStatus.UNAUTHORIZED)

    const ok = await agent
      .post('/api/v1/auth/mfa/disable')
      .set('x-csrf-token', csrf)
      .send({ code: totpFor(secret) })
    expect(ok.status).toBe(HttpStatus.OK)
    expect(ok.body.disabled).toBe(true)

    const status = await agent.get('/api/v1/auth/mfa/status').set('x-csrf-token', csrf)
    expect(status.body.enabled).toBe(false)

    const loginAfter = await login(agent, 'mfa-disable@test.local')
    expect(loginAfter.res.status).toBe(HttpStatus.OK)
    expect(loginAfter.res.body.mfaRequired).toBeUndefined()
    expect(loginAfter.res.headers['set-cookie']).toBeDefined()
  })
})