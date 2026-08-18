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
  CUSTOMER: ['claims:redeem', 'transfers:request'],
  STAFF: ['products:create', 'pieces:create', 'pieces:read', 'sales:create', 'transfers:manage']
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

describe('API e2e (bloqueos cruzados venta/transferencia/canje)', () => {
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
  let owner: ReturnType<typeof request.agent>
  let buyer: ReturnType<typeof request.agent>
  let ownerId = ''
  let buyerId = ''
  let productId = ''

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'st-staff@test.local')
    staff = s.agent
    const o = await authedActor('CUSTOMER', 'st-owner@test.local')
    owner = o.agent
    ownerId = o.userId
    const b = await authedActor('CUSTOMER', 'st-buyer@test.local')
    buyer = b.agent
    buyerId = b.userId

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-st-prod',
      name: 'Anillo Bloqueos',
      category: 'RING',
      basePurity: '14K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  async function createPiece() {
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '3.200',
      purity: '14K',
      material: 'GOLD',
      manufacturingDate: '2026-03-01T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    return piece.body.id as string
  }

  /** Pieza vendida y canjeada → el owner queda como propietario activo. */
  async function createOwnedPiece() {
    const pieceId = await createPiece()
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId: ownerId,
      amount: '750.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)
    const claim = await mutate(owner, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(claim.status).toBe(HttpStatus.CREATED)
    return pieceId
  }

  it('una transferencia PENDING bloquea la venta de la pieza (400)', async () => {
    const pieceId = await createOwnedPiece()
    // La pieza canjeada queda SOLD; para el escenario de reventa se devuelve
    // al stock (equivalente a una pieza recuperada tras un incidente).
    await prisma.jewelry_pieces.update({ where: { id: pieceId }, data: { status: 'IN_STOCK' } })
    const transfer = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: buyerId
    })
    expect(transfer.status).toBe(HttpStatus.CREATED)
    expect(transfer.body.status).toBe('PENDING')

    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId,
      amount: '700.00'
    })
    expect(sale.status).toBe(HttpStatus.BAD_REQUEST)
    expect(sale.body.message).toContain('transferencia pendiente')
  })

  it('una transferencia PENDING post-venta bloquea el canje y su cancelación lo desbloquea', async () => {
    const pieceId = await createPiece()
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId,
      amount: '800.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)

    // Simula la ventana de carrera: el vendedor solicita la transferencia
    // después de la venta pero antes del canje del comprador.
    const transfer = await prisma.ownership_transfers.create({
      data: {
        pieceId,
        fromUserId: ownerId,
        toUserId: buyerId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    })

    const blocked = await mutate(buyer, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(blocked.status).toBe(HttpStatus.CONFLICT)
    expect(blocked.body.message).toContain('transferencia pendiente')

    await prisma.ownership_transfers.delete({ where: { id: transfer.id } })

    const redeemed = await mutate(buyer, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(redeemed.status).toBe(HttpStatus.CREATED)
    const ownership = await prisma.ownership_records.findFirstOrThrow({
      where: { pieceId, endDate: null }
    })
    expect(ownership.ownerId).toBe(buyerId)
    expect(ownership.acquisitionType).toBe('CLAIM')
  })
})