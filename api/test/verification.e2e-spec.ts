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
  CUSTOMER: ['claims:redeem', 'pieces:read_own'],
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

describe('API e2e (verificación pública de identidad)', () => {
  let app: INestApplication
  let staff: ReturnType<typeof request.agent>

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
    staff = await staffAgent()
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

  async function mutate(agent: ReturnType<typeof request.agent>, method: 'post', url: string, body?: Record<string, unknown>) {
    const csrf = await agent.get('/api/v1/auth/csrf')
    const req = agent[method](url).set('x-csrf-token', csrf.body.csrfToken as string)
    if (body !== undefined) req.send(body)
    return req
  }

  async function staffAgent() {
    const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const user = await prisma.users.create({
      data: { email: 'verify-staff@test.local', passwordHash, firstName: 'STAFF', lastName: 'User', status: 'ACTIVE' }
    })
    const role = await prisma.roles.findUnique({ where: { name: 'STAFF' } })
    if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })

    const { agent, csrfToken } = await makeAgent()
    const login = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'verify-staff@test.local', password: PASSWORD })
    if (login.status !== HttpStatus.OK) throw new Error(`Login fallido: ${login.status}`)
    return agent
  }

  async function createUnclaimedPiece(sku: string) {
    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku,
      name: 'Anillo Verificación',
      category: 'RING',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId: product.body.id,
      weightGrams: '6.200',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    return { productId: product.body.id as string, pieceId: piece.body.id as string, verifyUrl: piece.body.verifyUrl as string }
  }

  it('verifica una pieza registrada sin autenticación (URL pública del QR)', async () => {
    const { verifyUrl } = await createUnclaimedPiece('ng-verify-prod-1')
    const token = verifyUrl.split('/').pop() as string

    const res = await server().get(`/verify/${token}`)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.body.verified).toBe(true)
    expect(res.body.piece.serialNumber).toMatch(/^NG-2026-/)
    expect(res.body.piece.publicId).toBeTypeOf('string')
    expect(res.body.piece.material).toBe('GOLD')
    expect(res.body.piece.purity).toBe('18K')
    expect(res.body.piece.weightGrams).toBeDefined()
    expect(res.body.piece).not.toHaveProperty('id')
    expect(res.body.product.sku).toBe('NG-VERIFY-PROD-1')
    expect(res.body.identity.registeredAt).toBeTypeOf('string')
    expect(res.body.ownership).toEqual({ registered: false, ownerName: null })

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('internalId')
    expect(serialized).not.toContain('identityHash')
    expect(serialized).not.toContain('@')
  })

  it('devuelve 404 para tokens inexistentes o identidades no activas', async () => {
    const missing = await server().get('/verify/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(missing.status).toBe(HttpStatus.NOT_FOUND)

    const { pieceId } = await createUnclaimedPiece('ng-verify-prod-2')
    await prisma.digital_identities.updateMany({
      where: { pieceId },
      data: { status: 'SUSPENDED' }
    })
    const identity = await prisma.digital_identities.findUnique({ where: { pieceId } })
    const revoked = await server().get(`/verify/${identity?.publicToken}`)
    expect(revoked.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('sigue verificando piezas vendidas e informa del propietario registrado', async () => {
    const buyerPasswordHash = await hash(PASSWORD, ARGON2_OPTIONS)
    const buyer = await prisma.users.create({
      data: {
        email: 'verify-buyer@test.local',
        passwordHash: buyerPasswordHash,
        firstName: 'Luisa',
        lastName: 'Martínez',
        status: 'ACTIVE'
      }
    })
    const role = await prisma.roles.findUnique({ where: { name: 'CUSTOMER' } })
    if (role) await prisma.user_roles.create({ data: { userId: buyer.id, roleId: role.id } })

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-verify-sold',
      name: 'Pulsera Verificación',
      category: 'BRACELET',
      basePurity: '18K'
    })
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId: product.body.id,
      weightGrams: '8.100',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece.body.id,
      buyerId: buyer.id,
      amount: '3200.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)

    const buyerAgent = await makeAgent()
    const buyerLogin = await buyerAgent.agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', buyerAgent.csrfToken)
      .send({ email: 'verify-buyer@test.local', password: PASSWORD })
    expect(buyerLogin.status).toBe(HttpStatus.OK)
    const claimed = await mutate(buyerAgent.agent, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(claimed.status).toBe(HttpStatus.CREATED)

    const token = (piece.body.verifyUrl as string).split('/').pop() as string
    const res = await server().get(`/verify/${token}`)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.body.piece.status).toBe('SOLD')
    expect(res.body.ownership).toEqual({ registered: true, ownerName: 'Luisa Martínez' })
  })
})