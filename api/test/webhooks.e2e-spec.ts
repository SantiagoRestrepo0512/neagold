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

const ROLE_PERMISSIONS: Record<string, string[]> = {
  STAFF: ['webhooks:manage'],
  CUSTOMER: []
}

async function seedRbacForTest() {
  for (const [roleName, codes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.roles.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: roleName }
    })
    for (const code of codes) {
      const permission = await prisma.permissions.upsert({
        where: { code },
        update: {},
        create: { code, description: code }
      })
      await prisma.role_permissions.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id }
      })
    }
  }
}

describe('API e2e (webhooks salientes)', () => {
  let app: INestApplication

  beforeAll(async () => {
    await truncateAll()
    await seedRbacForTest()
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
  }, 60000)

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

  async function mutate<T extends 'post' | 'patch' | 'put' | 'delete'>(
    agent: ReturnType<typeof request.agent>,
    method: T,
    url: string,
    body?: Record<string, unknown>
  ) {
    const csrf = await agent.get('/api/v1/auth/csrf')
    const req = agent[method](url).set('x-csrf-token', csrf.body.csrfToken as string)
    if (body !== undefined) req.send(body)
    return req
  }

  async function authedActor(roleName: string | null, email: string) {
    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const user = await prisma.users.create({
      data: {
        email,
        passwordHash,
        firstName: roleName ?? 'NoRole',
        lastName: 'User',
        status: 'ACTIVE'
      }
    })
    if (roleName) {
      const role = await prisma.roles.findUnique({ where: { name: roleName } })
      if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })
    }
    const { agent, csrfToken } = await makeAgent()
    const login = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email, password: PASSWORD })
    if (login.status !== HttpStatus.OK) throw new Error(`Login fallido para ${email}`)
    return { agent, userId: user.id }
  }

  let staff: ReturnType<typeof request.agent>
  let customer: ReturnType<typeof request.agent>

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'wh-staff@test.local')
    staff = s.agent
    const c = await authedActor('CUSTOMER', 'wh-customer@test.local')
    customer = c.agent
  }, 60000)

  it('protege las rutas de webhooks (401 anónimo y 403 sin permiso)', async () => {
    const anon = await server().get('/api/v1/webhooks')
    expect(anon.status).toBe(HttpStatus.UNAUTHORIZED)

    const forbidden = await mutate(customer, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com/ng',
      events: ['sale.created']
    })
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('crea un webhook y devuelve el secreto una sola vez', async () => {
    const res = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com/ng-events',
      events: ['sale.created', 'claim.redeemed']
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.body.webhook.url).toBe('https://hooks.example.com/ng-events')
    expect(res.body.webhook.events).toEqual(['sale.created', 'claim.redeemed'])
    expect(res.body.webhook.isActive).toBe(true)
    expect(res.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const list = await staff.get('/api/v1/webhooks')
    expect(list.status).toBe(HttpStatus.OK)
    expect(list.body.total).toBe(1)
    expect(list.body.items[0].url).toBe('https://hooks.example.com/ng-events')
    expect(list.body.items[0].secret).toBeUndefined()
  })

  it('rechaza protocolos no http(s) y eventos no soportados', async () => {
    const ftp = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'ftp://hooks.example.com/ng',
      events: ['sale.created']
    })
    expect(ftp.status).toBe(HttpStatus.BAD_REQUEST)

    const badEvent = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com/ng',
      events: ['not.an.event']
    })
    expect(badEvent.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rechaza URLs con credenciales embebidas y puertos sensibles (anti-SSRF)', async () => {
    const creds = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://user:pass@hooks.example.com/ng',
      events: ['sale.created']
    })
    expect(creds.status).toBe(HttpStatus.BAD_REQUEST)
    expect(creds.body.message).toContain('credenciales')

    const port = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com:5432/ng',
      events: ['sale.created']
    })
    expect(port.status).toBe(HttpStatus.BAD_REQUEST)
    expect(port.body.message).toContain('Puerto no permitido')
  })

  it('permite actualizar la URL del webhook pero no una inválida', async () => {
    const res = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com/ng-update',
      events: ['transfer.requested']
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    const id = res.body.webhook.id as string

    const updated = await mutate(staff, 'patch', `/api/v1/webhooks/${id}`, {
      url: 'https://hooks-new.example.com/ng',
      events: ['transfer.requested', 'transfer.accepted']
    })
    expect(updated.status).toBe(HttpStatus.OK)
    expect(updated.body.webhook.url).toBe('https://hooks-new.example.com/ng')

    const bad = await mutate(staff, 'patch', `/api/v1/webhooks/${id}`, {
      url: 'ftp://hooks-new.example.com/ng'
    })
    expect(bad.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rota el secreto de firma y luego elimina el webhook', async () => {
    const res = await mutate(staff, 'post', '/api/v1/webhooks', {
      url: 'https://hooks.example.com/ng-secret',
      events: ['incident.reported']
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    const id = res.body.webhook.id as string
    const originalSecret = res.body.secret as string

    const rotated = await mutate(staff, 'post', `/api/v1/webhooks/${id}/secret`)
    expect(rotated.status).toBe(HttpStatus.OK)
    expect(rotated.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rotated.body.secret).not.toBe(originalSecret)

    const removed = await mutate(staff, 'delete', `/api/v1/webhooks/${id}`)
    expect(removed.status).toBe(HttpStatus.OK)
    expect(removed.body.deleted).toBe(true)

    const detail = await staff.get(`/api/v1/webhooks/${id}`)
    expect(detail.status).toBe(HttpStatus.NOT_FOUND)
  })
})