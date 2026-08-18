import 'reflect-metadata'
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { argon2id, hash } from 'argon2'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../dist/app.module'
import { prisma, truncateAll } from '../../prisma/tests/helpers'
import { listenForTests } from './test-server'

const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD = 'Str0ng!Passw0rd'

const cookieValue = (setCookie: string[], name: string): string => {
  const match = setCookie.join(';').match(new RegExp(`${name}=([^;]+)`))
  if (!match) throw new Error(`Cookie ${name} no encontrada`)
  return match[1]
}

describe('API e2e (auth y salud)', () => {
  let app: INestApplication

  beforeAll(async () => {
    await truncateAll()
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.enableCors({
      origin: ['http://localhost:5173'],
      credentials: true
    })
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready', 'verify/{*splat}'] })
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    )
    await app.init()
    await listenForTests(app)
  })

  afterAll(async () => {
    await app?.close()
  })

  function server() {
    return request(app.getHttpServer())
  }

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
        firstName: 'Direct',
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

  async function loginWithAgent(agent: ReturnType<typeof request.agent>, csrfToken: string, email: string) {
    return agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email, password: PASSWORD })
  }

  it('health y ready responden 200 (con chequeo de BD)', async () => {
    const health = await server().get('/health')
    expect(health.status).toBe(HttpStatus.OK)
    expect(health.body.status).toBe('ok')

    const ready = await server().get('/ready')
    expect(ready.status).toBe(HttpStatus.OK)
    expect(ready.body.database).toBe('up')
  })

  it('emite cookie CSRF pública', async () => {
    const res = await server().get('/api/v1/auth/csrf')
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.body.csrfToken).toBeTypeOf('string')
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.join(';')).toContain('ng_csrf')
  })

  it('rechaza mutaciones sin cookie/header CSRF', async () => {
    const res = await server().post('/api/v1/auth/register').send({
      email: 'csrf@test.local',
      password: PASSWORD,
      firstName: 'A',
      lastName: 'B'
    })
    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('registra, valida el email y permite login (cookies access+refresh)', async () => {
    const { agent, csrfToken } = await makeAgent()
    const reg = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'cliente@test.local', password: PASSWORD, firstName: 'Ana', lastName: 'López' })
    expect(reg.status).toBe(HttpStatus.CREATED)
    expect(reg.body.devVerifyUrl).toBeTypeOf('string')

    const pending = await loginWithAgent(agent, csrfToken, 'cliente@test.local')
    expect(pending.status).toBe(HttpStatus.FORBIDDEN)

    const token = (reg.body.devVerifyUrl as string).split('/').pop() as string
    const verified = await agent.get(`/api/v1/auth/verify-email/${encodeURIComponent(token)}`)
    expect(verified.status).toBe(HttpStatus.OK)

    const login = await loginWithAgent(agent, csrfToken, 'cliente@test.local')
    expect(login.status).toBe(HttpStatus.OK)
    expect(login.body.user.email).toBe('cliente@test.local')
    const cookies = login.headers['set-cookie'] as unknown as string[]
    expect(cookies.join(';')).toContain('ng_access=')
    expect(cookies.join(';')).toContain('ng_refresh=')
  }, 30000)

  it('valida DTOs (password débil y cuerpo extra) con 400', async () => {
    const { agent, csrfToken } = await makeAgent()
    const weak = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'weak@test.local', password: 'corta', firstName: 'Ana', lastName: 'Gomez' })
    expect(weak.status).toBe(HttpStatus.BAD_REQUEST)

    const extra = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'extra@test.local', password: PASSWORD, firstName: 'Ana', lastName: 'Gomez', admin: true })
    expect(extra.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rechaza email duplicado con 409', async () => {
    const { agent, csrfToken } = await makeAgent()
    const first = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'dup@test.local', password: PASSWORD, firstName: 'Ana', lastName: 'Gomez' })
    expect(first.status).toBe(HttpStatus.CREATED)
    const second = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'dup@test.local', password: PASSWORD, firstName: 'Ana', lastName: 'Gomez' })
    expect(second.status).toBe(HttpStatus.CONFLICT)
  })

  it('no bloquea la cuenta por fallos desde una sola IP (anti lockout DoS)', async () => {
    const { agent } = await makeAgent()
    await createActiveUser('lockout-single-ip@test.local')
    let csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrf)
        .send({ email: 'lockout-single-ip@test.local', password: 'Wrong!Password1' })
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
      csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    }
    const after = await prisma.users.findUnique({
      where: { email: 'lockout-single-ip@test.local' },
      select: { failedLoginAttempts: true, lockedUntil: true }
    })
    expect(after?.failedLoginAttempts).toBe(5)
    expect(after?.lockedUntil).toBeNull()
    const ok = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'lockout-single-ip@test.local', password: PASSWORD })
    expect(ok.status).toBe(HttpStatus.OK)
  }, 30000)

  it('bloquea la cuenta cuando los fallos vienen de 2+ IPs distintas', async () => {
    const { agent } = await makeAgent()
    await createActiveUser('lockout-multi-ip@test.local')
    let csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    for (let i = 0; i < 3; i++) {
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrf)
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email: 'lockout-multi-ip@test.local', password: 'Wrong!Password1' })
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
      csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    }
    for (let i = 0; i < 2; i++) {
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrf)
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: 'lockout-multi-ip@test.local', password: 'Wrong!Password1' })
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
      csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string
    }
    const blocked = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ email: 'lockout-multi-ip@test.local', password: PASSWORD })
    // El contrato del lockout es un 423 explícito (HTTP 423 Locked)
    expect(blocked.status).toBe(423)
    expect(blocked.body.code).toBe('ACCOUNT_LOCKED')
    expect(blocked.body.message).toContain('bloqueada')
  }, 30000)

  it('/users/me exige token y devuelve perfil con id, email y roles', async () => {
    const { agent, csrfToken } = await makeAgent()
    await createActiveUser('me@test.local')
    const login = await loginWithAgent(agent, csrfToken, 'me@test.local')
    expect(login.status).toBe(HttpStatus.OK)
    const accessToken = cookieValue(login.headers['set-cookie'] as unknown as string[], 'ng_access')

    const anon = await server().get('/api/v1/users/me')
    expect(anon.status).toBe(HttpStatus.UNAUTHORIZED)

    const me = await server().get('/api/v1/users/me').set('Cookie', `ng_access=${accessToken}`)
    expect(me.status).toBe(HttpStatus.OK)
    expect(me.body.id).toBeTypeOf('string')
    expect(me.body.email).toBe('me@test.local')
    expect(me.body.firstName).toBe('Direct')
    expect(me.body.status).toBe('ACTIVE')
  }, 30000)

  it('rota el refresh token y revoca la familia si se reusa uno ya rotado', async () => {
    const { agent, csrfToken } = await makeAgent()
    await createActiveUser('rotate@test.local')
    const login = await loginWithAgent(agent, csrfToken, 'rotate@test.local')
    expect(login.status).toBe(HttpStatus.OK)
    const firstRefresh = cookieValue(login.headers['set-cookie'] as unknown as string[], 'ng_refresh')

    const refreshed = await agent.post('/api/v1/auth/refresh')
    expect(refreshed.status).toBe(HttpStatus.OK)
    expect(refreshed.body.refreshed).toBe(true)
    const setCookie = refreshed.headers['set-cookie'] as unknown as string[]
    expect(setCookie.join(';')).toContain('ng_access=')
    const secondRefresh = cookieValue(setCookie, 'ng_refresh')
    expect(secondRefresh).not.toBe(firstRefresh)

    const reuse = await server().post('/api/v1/auth/refresh').set('Cookie', `ng_refresh=${firstRefresh}`)
    expect(reuse.status).toBe(HttpStatus.UNAUTHORIZED)

    const familyReuse = await server()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `ng_refresh=${secondRefresh}`)
    expect(familyReuse.status).toBe(HttpStatus.UNAUTHORIZED)
  }, 30000)

  it('logout invalida la sesión y el refresh posterior falla', async () => {
    const { agent, csrfToken } = await makeAgent()
    await createActiveUser('logout@test.local')
    const login = await loginWithAgent(agent, csrfToken, 'logout@test.local')
    expect(login.status).toBe(HttpStatus.OK)
    const refreshCookie = cookieValue(login.headers['set-cookie'] as unknown as string[], 'ng_refresh')

    const logout = await agent
      .post('/api/v1/auth/logout')
      .set('Cookie', `ng_refresh=${refreshCookie}`)
    expect(logout.status).toBe(HttpStatus.NO_CONTENT)

    const after = await server().post('/api/v1/auth/refresh').set('Cookie', `ng_refresh=${refreshCookie}`)
    expect(after.status).toBe(HttpStatus.UNAUTHORIZED)
  }, 30000)

  it('aplica rate limiting en forgot-password (429)', async () => {
    const { agent, csrfToken } = await makeAgent()
    await createActiveUser('ratelimit@test.local')
    let got429 = false
    for (let i = 0; i < 6; i++) {
      const res = await agent
        .post('/api/v1/auth/forgot-password')
        .set('x-csrf-token', csrfToken)
        .send({ email: i % 2 === 0 ? 'ratelimit@test.local' : 'other@test.local' })
      if (res.status === HttpStatus.TOO_MANY_REQUESTS) {
        got429 = true
        break
      }
    }
    expect(got429).toBe(true)
  }, 30000)

  it('aplica rate limiting en mfa/verify (429)', async () => {
    const { agent, csrfToken } = await makeAgent()
    let got429 = false
    for (let i = 0; i < 8; i++) {
      const res = await agent
        .post('/api/v1/auth/mfa/verify')
        .set('x-csrf-token', csrfToken)
        .send({ challengeToken: 'challenge-invalido', code: '000000' })
      if (res.status === HttpStatus.TOO_MANY_REQUESTS) {
        got429 = true
        break
      }
    }
    expect(got429).toBe(true)
  }, 30000)

  it('aplica rate limiting en login (429)', async () => {
    const limit = Number(process.env.LOGIN_THROTTLE_LIMIT ?? 100)
    const { agent, csrfToken } = await makeAgent()
    let got429 = false
    // Emails inexistentes rotativos: la verificación dummy evita el lockout
    // de cuenta (5 fallos) que enmascararía el 429 del throttle.
    for (let i = 0; i < limit + 20 && !got429; i++) {
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({ email: `login-throttle-${i}@test.local`, password: 'Wrong!Password1' })
      got429 = res.status === HttpStatus.TOO_MANY_REQUESTS
    }
    expect(got429).toBe(true)
  }, 60000)
})