import 'reflect-metadata'
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { argon2id, hash } from 'argon2'
import { createHash } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../dist/app.module'
import { prisma, truncateAll } from '../../prisma/tests/helpers'
import { listenForTests } from './test-server'

const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD = 'Str0ng!Passw0rd'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: ['pieces:read_own', 'claims:redeem'],
  STAFF: [
    'products:create',
    'products:read',
    'products:update',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:update_status',
    'pieces:retire',
    'qr:regenerate',
    'sales:create',
    'sales:read',
    'claims:read',
    'claims:create'
  ],
  ADMIN: [
    'products:create',
    'products:read',
    'products:update',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:update_status',
    'pieces:retire',
    'qr:regenerate',
    'sales:create',
    'sales:read',
    'claims:read',
    'claims:create'
  ]
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

async function createUserWithRole(email: string, roleName: string) {
  const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
  const user = await prisma.users.create({
    data: { email, passwordHash, firstName: roleName, lastName: 'User', status: 'ACTIVE' }
  })
  const role = await prisma.roles.findUnique({ where: { name: roleName } })
  if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })
  return user
}

describe('API e2e (negocio: productos, piezas, ventas, reclamaciones)', () => {
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

  async function loginAgent(agent: ReturnType<typeof request.agent>, csrfToken: string, email: string) {
    const res = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email, password: PASSWORD })
    if (res.status !== HttpStatus.OK) throw new Error(`Login fallido para ${email}: ${res.status}`)
    return res
  }

  /** Mutación autenticada: refresca el token CSRF (rota por request) y lo envía. */
  async function mutate<T extends { method: 'post' | 'patch' | 'put' | 'delete' }>(
    agent: ReturnType<typeof request.agent>,
    method: T['method'],
    url: string,
    body?: Record<string, unknown>
  ) {
    const csrf = await agent.get('/api/v1/auth/csrf')
    const req = agent[method](url).set('x-csrf-token', csrf.body.csrfToken as string)
    if (body !== undefined) req.send(body)
    return req
  }

  async function authedActor(roleName: string, email: string) {
    const user = await createUserWithRole(email, roleName)
    const { agent, csrfToken } = await makeAgent()
    await loginAgent(agent, csrfToken, email)
    return { agent, userId: user.id }
  }

  let staff: ReturnType<typeof request.agent>
  let admin: ReturnType<typeof request.agent>
  let buyer: ReturnType<typeof request.agent>
  let buyerId: string
  let productId = ''
  let pieceId = ''
  let claimCode = ''

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'staff@test.local')
    staff = s.agent
    const a = await authedActor('ADMIN', 'admin@test.local')
    admin = a.agent
    const b = await authedActor('CUSTOMER', 'buyer@test.local')
    buyer = b.agent
    buyerId = b.userId
  }, 60000)

  it('protege las rutas de negocio (401 anónimo y 403 sin permiso)', async () => {
    const anonProducts = await server().get('/api/v1/products')
    expect(anonProducts.status).toBe(HttpStatus.UNAUTHORIZED)

    const anonList = await server().get('/api/v1/pieces')
    expect(anonList.status).toBe(HttpStatus.UNAUTHORIZED)

    const forbidden = await mutate(buyer, 'post', '/api/v1/products', {
      sku: 'X-1',
      name: 'Intento cliente',
      category: 'RING',
      basePurity: '18K'
    })
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('crea, lista y actualiza productos (admin)', async () => {
    const created = await mutate(admin, 'post', '/api/v1/products', {
      sku: 'ng-anillo-18k',
      name: 'Anillo Oro 18K',
      description: 'Anillo clásico',
      category: 'RING',
      basePurity: '18K',
      baseWeightGrams: '6.200'
    })
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.body.sku).toBe('NG-ANILLO-18K')
    productId = created.body.id as string

    const dup = await mutate(admin, 'post', '/api/v1/products', {
      sku: 'ng-anillo-18k',
      name: 'Duplicado',
      category: 'RING',
      basePurity: '18K'
    })
    expect(dup.status).toBe(HttpStatus.CONFLICT)

    const invalid = await mutate(admin, 'post', '/api/v1/products', {
      sku: 'ab',
      name: 'Sku muy corto',
      category: 'RING',
      basePurity: '18K',
      baseWeightGrams: '6.2000'
    })
    expect(invalid.status).toBe(HttpStatus.BAD_REQUEST)

    const list = await admin.get('/api/v1/products')
    expect(list.status).toBe(HttpStatus.OK)
    expect(list.body.total).toBe(1)

    const patched = await mutate(admin, 'patch', `/api/v1/products/${productId}`, {
      name: 'Anillo Oro 18K Edición'
    })
    expect(patched.status).toBe(HttpStatus.OK)
    expect(patched.body.name).toBe('Anillo Oro 18K Edición')
  })

  it('registra una pieza con serial, identidad y QR (staff)', async () => {
    const res = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '6.200',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.body.serialNumber).toMatch(/^NG-2026-\d{6}$/)
    expect(res.body.internalId).toMatch(/^NG-INT-2026-\d{4}$/)
    expect(res.body.status).toBe('IN_STOCK')
    expect(res.body.verifyUrl).toMatch(/^https:\/\/neagold\.com\/verify\/[a-f0-9]{64}$/)
    expect(res.body.qrToken).toMatch(/^[a-f0-9]{64}$/)
    expect(res.body.identityHash).toMatch(/^[a-f0-9]{64}$/)
    pieceId = res.body.id as string

    const detail = await admin.get(`/api/v1/pieces/${pieceId}`)
    expect(detail.status).toBe(HttpStatus.OK)
    expect(detail.body.product.sku).toBe('NG-ANILLO-18K')
    expect(detail.body.currentOwner).toBeNull()
    expect(detail.body.activeQr.token).toBe(res.body.qrToken)

    const foreign = await buyer.get(`/api/v1/pieces/${pieceId}`)
    expect(foreign.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('rechaza la transición manual a SOLD y permite cambios válidos', async () => {
    const directSold = await mutate(staff, 'patch', `/api/v1/pieces/${pieceId}/status`, {
      status: 'SOLD'
    })
    expect(directSold.status).toBe(HttpStatus.BAD_REQUEST)
    expect(directSold.body.message).toContain('flujo de venta')

    const available = await mutate(staff, 'patch', `/api/v1/pieces/${pieceId}/status`, {
      status: 'AVAILABLE'
    })
    expect(available.status).toBe(HttpStatus.OK)
    expect(available.body.status).toBe('AVAILABLE')
  })

  it('vende la pieza: factura, código de reclamación y estado SOLD', async () => {
    const res = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId,
      amount: '2450.00'
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.body.sale.invoiceNumber).toMatch(/^NG-INV-2026-\d{6}$/)
    expect(res.body.sale.buyerId).toBe(buyerId)
    expect(res.body.claimCode).toMatch(/^NG-CLAIM-2026-[A-F0-9]{32}$/)
    expect(res.body.claimExpiresAt).toBeTypeOf('string')
    claimCode = res.body.claimCode as string

    const detail = await admin.get(`/api/v1/pieces/${pieceId}`)
    expect(detail.status).toBe(HttpStatus.OK)
    expect(detail.body.status).toBe('SOLD')

    const attempts = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId,
      amount: '100.00'
    })
    expect(attempts.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('valida la venta (comprador inexistente, monto inválido, pieza inexistente)', async () => {
    const noBuyer = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId: '00000000-0000-0000-0000-000000000000',
      amount: '100.00'
    })
    expect(noBuyer.status).toBe(HttpStatus.BAD_REQUEST)

    const badAmount = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId,
      buyerId,
      amount: '100.999'
    })
    expect(badAmount.status).toBe(HttpStatus.BAD_REQUEST)

    const noPiece = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: '00000000-0000-0000-0000-000000000000',
      buyerId,
      amount: '100.00'
    })
    expect(noPiece.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('el comprador puede canjear su código de reclamación una sola vez', async () => {
    const redeemed = await mutate(buyer, 'post', '/api/v1/claims/redeem', { code: claimCode })
    expect(redeemed.status).toBe(HttpStatus.CREATED)
    expect(redeemed.body.redeemed).toBe(true)
    expect(redeemed.body.piece.serialNumber).toMatch(/^NG-2026-/)
    expect(redeemed.body.verifyUrl).toMatch(/^https:\/\/neagold\.com\/verify\//)

    const again = await mutate(buyer, 'post', '/api/v1/claims/redeem', { code: claimCode })
    expect(again.status).toBe(HttpStatus.CONFLICT)

    const record = await prisma.piece_claim_codes.findUnique({
      where: { codeHash: createHash('sha256').update(claimCode).digest('hex') },
      include: { sale: { select: { id: true } } }
    })
    expect(record?.status).toBe('USED')
  })

  it('rechaza códigos ajenos, inventados y el canje de otro cliente', async () => {
    const other = await authedActor('CUSTOMER', 'other@test.local')
    const piece2 = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '5.100',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-03-01T00:00:00.000Z'
    })
    expect(piece2.status).toBe(HttpStatus.CREATED)
    const sale2 = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece2.body.id,
      buyerId: other.userId,
      amount: '1890.00'
    })
    expect(sale2.status).toBe(HttpStatus.CREATED)
    const otherCode = sale2.body.claimCode as string

    const foreign = await mutate(buyer, 'post', '/api/v1/claims/redeem', { code: otherCode })
    expect(foreign.status).toBe(HttpStatus.FORBIDDEN)

    const bogus = await mutate(buyer, 'post', '/api/v1/claims/redeem', {
      code: 'NG-CLAIM-2026-DEADBEEFDEADBEEFDEADBEEFDEADBEEF'
    })
    expect(bogus.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('verifica la propiedad del comprador tras el canje (piece:read_own)', async () => {
    const owned = await buyer.get(`/api/v1/pieces/${pieceId}`)
    expect(owned.status).toBe(HttpStatus.OK)
    expect(owned.body.currentOwner.email).toBe('buyer@test.local')
    expect(owned.body.status).toBe('SOLD')
  })

  it('regenera el QR (revoca el anterior, emite uno nuevo)', async () => {
    const before = await admin.get(`/api/v1/pieces/${pieceId}`)
    const oldToken = before.body.activeQr.token

    const regen = await mutate(staff, 'post', `/api/v1/pieces/${pieceId}/qr/regenerate`)
    expect(regen.status).toBe(HttpStatus.CREATED)
    expect(regen.body.qrToken).not.toBe(oldToken)
    expect(regen.body.previousRevoked).toBe(true)

    const after = await admin.get(`/api/v1/pieces/${pieceId}`)
    expect(after.body.activeQr.token).toBe(regen.body.qrToken)
    expect(after.body.digitalIdentity.publicToken).toBe(before.body.digitalIdentity.publicToken)
  })

  it('retira una pieza no vendida del ciclo', async () => {
    const second = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '4.500',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-02-01T00:00:00.000Z'
    })
    expect(second.status).toBe(HttpStatus.CREATED)
    const secondId = second.body.id as string

    const retired = await mutate(staff, 'post', `/api/v1/pieces/${secondId}/retire`)
    expect(retired.status).toBe(HttpStatus.OK)
    expect(retired.body.status).toBe('RETIRED')

    const again = await mutate(staff, 'post', `/api/v1/pieces/${secondId}/retire`)
    expect(again.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('lista ventas y reclamaciones como staff (con filtro de propiedad para clientes)', async () => {
    const sales = await staff.get('/api/v1/sales')
    expect(sales.status).toBe(HttpStatus.OK)
    expect(sales.body.total).toBe(2)
    expect(sales.body.items[0].invoiceNumber).toBeTypeOf('string')

    const claims = await admin.get('/api/v1/claims')
    expect(claims.status).toBe(HttpStatus.OK)
    expect(claims.body.total).toBe(2)
    const used = claims.body.items.find((item: { status: string }) => item.status === 'USED')
    expect(used).toBeDefined()

    const bought = await buyer.get('/api/v1/claims')
    expect(bought.status).toBe(HttpStatus.FORBIDDEN)

    const other = await authedActor('CUSTOMER', 'other2@test.local')
    const otherClaims = await other.agent.get('/api/v1/claims')
    expect(otherClaims.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('permite buscar compradores activos solo con sales:create y nunca expone datos sensibles', async () => {
    const buyers = await staff.get('/api/v1/users?search=buyer')
    expect(buyers.status).toBe(HttpStatus.OK)
    expect(buyers.body.length).toBeGreaterThan(0)
    expect(buyers.body[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), email: expect.any(String) })
    )
    expect(buyers.body[0]).not.toHaveProperty('passwordHash')

    const denied = await buyer.get('/api/v1/users?search=buyer')
    expect(denied.status).toBe(HttpStatus.FORBIDDEN)

    const anon = await server().get('/api/v1/users')
    expect(anon.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})