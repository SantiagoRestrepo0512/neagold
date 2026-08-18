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
const IDEMPOTENCY_HEADER = 'idempotency-key'
const REPLAYED_HEADER = 'x-idempotency-replayed'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: ['pieces:read_own', 'claims:redeem'],
  STAFF: ['products:create', 'pieces:create', 'sales:create']
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

describe('API e2e (idempotencia de mutaciones)', () => {
  let app: INestApplication
  let staffUser: { id: string }
  let staffAgent: ReturnType<typeof request.agent>
  let productId = ''

  beforeAll(async () => {
    await truncateAll()
    await seedRbacForTest()
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready', 'verify/{*splat}'] })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
    await listenForTests(app)

    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const user = await prisma.users.create({
      data: {
        email: 'idem-staff@test.local',
        passwordHash,
        firstName: 'STAFF',
        lastName: 'User',
        status: 'ACTIVE'
      }
    })
    staffUser = { id: user.id }
    const role = await prisma.roles.findUnique({ where: { name: 'STAFF' } })
    if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })

    staffAgent = request.agent(app.getHttpServer())
    const csrf = await staffAgent.get('/api/v1/auth/csrf')
    const login = await staffAgent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf.body.csrfToken as string)
      .send({ email: 'idem-staff@test.local', password: PASSWORD })
    if (login.status !== HttpStatus.OK) throw new Error(`Login fallido: ${login.status}`)

    const product = await mutate(staffAgent, 'post', '/api/v1/products', {
      sku: 'ng-idem',
      name: 'Idempotencia',
      category: 'RING',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  async function mutate(
    agent: ReturnType<typeof request.agent>,
    method: 'post' | 'patch' | 'put' | 'delete',
    url: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    const csrf = await agent.get('/api/v1/auth/csrf')
    const req = agent[method](url).set('x-csrf-token', csrf.body.csrfToken as string)
    if (idempotencyKey !== undefined) req.set(IDEMPOTENCY_HEADER, idempotencyKey)
    if (body !== undefined) req.send(body)
    return req
  }

  async function createPiece(): Promise<string> {
    const res = await mutate(staffAgent, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '6.200',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    return res.body.id as string
  }

  async function createBuyer(email: string): Promise<string> {
    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const user = await prisma.users.create({
      data: { email, passwordHash, firstName: 'C', lastName: 'B', status: 'ACTIVE' }
    })
    return user.id
  }

  it('rejuega la misma respuesta para la misma clave', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-1@test.local')
    const body = { pieceId, buyerId, amount: '1000.00' }
    const key = 'replay-key-0001'

    const first = await mutate(staffAgent, 'post', '/api/v1/sales', body, key)
    expect(first.status).toBe(HttpStatus.CREATED)
    expect(first.headers[REPLAYED_HEADER]).toBeUndefined()

    const second = await mutate(staffAgent, 'post', '/api/v1/sales', body, key)
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.headers[REPLAYED_HEADER]).toBe('true')
    expect(second.body).toEqual(first.body)

    const sales = await prisma.sales.count({ where: { pieceId } })
    expect(sales).toBe(1)
  })

  it('no rejuega entre usuarios distintos (misma clave y ruta)', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-2@test.local')
    const body = { pieceId, buyerId, amount: '2000.00' }
    const key = 'shared-key-0001'

    const first = await mutate(staffAgent, 'post', '/api/v1/sales', body, key)
    expect(first.status).toBe(HttpStatus.CREATED)

    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const other = await prisma.users.create({
      data: {
        email: 'idem-staff-2@test.local',
        passwordHash,
        firstName: 'STAFF',
        lastName: 'User',
        status: 'ACTIVE'
      }
    })
    const role = await prisma.roles.findUnique({ where: { name: 'STAFF' } })
    if (role) await prisma.user_roles.create({ data: { userId: other.id, roleId: role.id } })
    const agent2 = request.agent(app.getHttpServer())
    const csrf2 = await agent2.get('/api/v1/auth/csrf')
    const login2 = await agent2
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf2.body.csrfToken as string)
      .send({ email: 'idem-staff-2@test.local', password: PASSWORD })
    if (login2.status !== HttpStatus.OK) throw new Error(`Login fallido: ${login2.status}`)
    const csrf3 = await agent2.get('/api/v1/auth/csrf')
    const otherPiece = await agent2
      .post('/api/v1/pieces')
      .set('x-csrf-token', csrf3.body.csrfToken as string)
      .send({
        productId,
        weightGrams: '7.100',
        purity: '18K',
        material: 'GOLD',
        manufacturingDate: '2026-02-01T00:00:00.000Z'
      })
    expect(otherPiece.status).toBe(HttpStatus.CREATED)
    const csrf4 = await agent2.get('/api/v1/auth/csrf')
    const second = await agent2
      .post('/api/v1/sales')
      .set('x-csrf-token', csrf4.body.csrfToken as string)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ pieceId: otherPiece.body.id, buyerId, amount: '2000.00' })
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.headers[REPLAYED_HEADER]).toBeUndefined()
    expect(second.body).not.toEqual(first.body)
  })

  it('no almacena respuestas de error (permite reintentar con la misma clave)', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-3@test.local')
    const key = 'fail-key-0001'

    const bad = await mutate(staffAgent, 'post', '/api/v1/sales', { pieceId, buyerId }, key)
    expect(bad.status).toBe(HttpStatus.BAD_REQUEST)

    const retry = await mutate(
      staffAgent,
      'post',
      '/api/v1/sales',
      { pieceId, buyerId, amount: '999.00' },
      key
    )
    expect(retry.status).toBe(HttpStatus.CREATED)
    expect(retry.headers[REPLAYED_HEADER]).toBeUndefined()
  })

  it('descarta claves expiradas y rejuega la respuesta nueva', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-4@test.local')
    const body = { pieceId, buyerId, amount: '1500.00' }
    const key = 'expired-key-0001'

    await prisma.idempotency_keys.create({
      data: {
        userId: staffUser.id,
        key,
        requestPath: '/api/v1/sales',
        responseStatus: 201,
        responseBody: { stale: true },
        expiresAt: new Date(Date.now() - 1000)
      }
    })

    const first = await mutate(staffAgent, 'post', '/api/v1/sales', body, key)
    expect(first.status).toBe(HttpStatus.CREATED)
    expect(first.headers[REPLAYED_HEADER]).toBeUndefined()
    expect(first.body).not.toEqual({ stale: true })

    const second = await mutate(staffAgent, 'post', '/api/v1/sales', body, key)
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.headers[REPLAYED_HEADER]).toBe('true')
    expect(second.body).toEqual(first.body)
  })

  it('rechaza claves con formato inválido sin ejecutar la mutación', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-5@test.local')
    const body = { pieceId, buyerId, amount: '500.00' }
    const salesBefore = await prisma.sales.count()

    const res = await mutate(staffAgent, 'post', '/api/v1/sales', body, 'x!')
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await prisma.sales.count()).toBe(salesBefore)
  })

  it('serializa peticiones concurrentes: una sola operación y respuestas idénticas', async () => {
    const pieceId = await createPiece()
    const buyerId = await createBuyer('idem-buyer-6@test.local')
    const body = { pieceId, buyerId, amount: '777.00' }
    const key = 'concurrent-key-0001'
    const salesBefore = await prisma.sales.count()

    const results = await Promise.all(
      Array.from({ length: 3 }, async (_, i) => {
        const agent = request.agent(app.getHttpServer())
        const urls: string[] = []
        const stepOf = (url: string) => (url.endsWith('/auth/csrf') ? 'csrf' : url.endsWith('/auth/login') ? 'login' : 'sales')
        try {
          const csrf = await agent.get('/api/v1/auth/csrf').on('response', (r) => urls.push(r.req.path))
          const login = await agent
            .post('/api/v1/auth/login')
            .set('x-csrf-token', csrf.body.csrfToken as string)
            .send({ email: 'idem-staff@test.local', password: PASSWORD })
            .on('response', (r) => urls.push(r.req.path))
          if (login.status !== HttpStatus.OK) throw new Error(`login ${login.status}`)
          const fresh = await agent.get('/api/v1/auth/csrf').on('response', (r) => urls.push(r.req.path))
          return await agent
            .post('/api/v1/sales')
            .set('x-csrf-token', fresh.body.csrfToken as string)
            .set(IDEMPOTENCY_HEADER, key)
            .send(body)
            .on('response', (r) => urls.push(r.req.path))
        } catch (error) {
          const last = urls[urls.length - 1] ?? 'ninguna'
          throw new Error(
            `request ${i} [${stepOf(last)}] falló tras ${urls.length} pasos (última URL: ${last}): ${String(
              error instanceof Error ? error.message : error
            )}`
          )
        }
      })
    )

    for (const res of results) {
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.body).toEqual(results[0].body)
    }

    const salesAfter = await prisma.sales.count()
    expect(salesAfter - salesBefore).toBe(1)
    const keys = await prisma.idempotency_keys.count({
      where: { userId: staffUser.id, key, requestPath: '/api/v1/sales' }
    })
    expect(keys).toBe(1)
  })
})