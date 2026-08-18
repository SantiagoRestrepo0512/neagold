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

const CLAIM_CODE_RE = /^NG-CLAIM-\d{4}-[0-9A-F]{32}$/
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: ['claims:redeem'],
  STAFF: ['products:create', 'pieces:create', 'pieces:read', 'sales:create']
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

describe('API e2e (códigos de reclamación)', () => {
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
  let customer: ReturnType<typeof request.agent>
  let customerId = ''
  let productId = ''

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'cl-staff@test.local')
    staff = s.agent
    const c = await authedActor('CUSTOMER', 'cl-buyer@test.local')
    customer = c.agent
    customerId = c.userId

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-claim-prod',
      name: 'Pulsera Claims',
      category: 'BRACELET',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  async function createPieceAndSell() {
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '5.500',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-02-10T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece.body.id,
      buyerId: customerId,
      amount: '1200.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)
    return { pieceId: piece.body.id as string, claimCode: sale.body.claimCode as string }
  }

  it('genera códigos de reclamación únicos con formato y entropía de 128 bits', async () => {
    const codes = [
      await createPieceAndSell(),
      await createPieceAndSell(),
      await createPieceAndSell()
    ].map((r) => r.claimCode)

    for (const code of codes) {
      expect(code).toMatch(CLAIM_CODE_RE)
    }
    expect(new Set(codes).size).toBe(codes.length)
    const suffixes = codes.map((code) => code.split('-').at(-1) as string)
    expect(new Set(suffixes).size).toBe(suffixes.length)
  })

  it('persiste solo el hash del código en BD, nunca el código en claro', async () => {
    const { claimCode } = await createPieceAndSell()
    const record = await prisma.piece_claim_codes.findUniqueOrThrow({
      where: { codeHash: sha256(claimCode) }
    })
    expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.codeHash).not.toBe(claimCode)
    const allHashes = await prisma.piece_claim_codes.findMany({ select: { codeHash: true } })
    const hashes = new Set(allHashes.map((r) => r.codeHash))
    expect(hashes.has(claimCode)).toBe(false)
  })

  it('el canje consume el código de un solo uso (409 en el segundo intento)', async () => {
    const { claimCode } = await createPieceAndSell()
    const first = await mutate(customer, 'post', '/api/v1/claims/redeem', { code: claimCode })
    expect(first.status).toBe(HttpStatus.CREATED)

    const second = await mutate(customer, 'post', '/api/v1/claims/redeem', { code: claimCode })
    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(second.body.message).toContain('ya fue canjeado')
  })
})