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
const DAY_MS = 24 * 60 * 60 * 1000

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: ['pieces:read_own', 'claims:redeem', 'transfers:request', 'transfers:accept', 'transfers:reject'],
  STAFF: [
    'products:create',
    'products:read',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:read_own',
    'pieces:retire',
    'sales:create',
    'sales:read',
    'transfers:manage'
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

async function createUserWithRole(email: string, roleName: string | null) {
  const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
  const user = await prisma.users.create({
    data: { email, passwordHash, firstName: roleName ?? 'NoRole', lastName: 'User', status: 'ACTIVE' }
  })
  if (roleName) {
    const role = await prisma.roles.findUnique({ where: { name: roleName } })
    if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })
  }
  return user
}

describe('API e2e (transferencias de propiedad)', () => {
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
  const user = await createUserWithRole(email, roleName)
    const { agent, csrfToken } = await makeAgent()
    await loginAgent(agent, csrfToken, email)
    return { agent, userId: user.id }
  }

  let staff: ReturnType<typeof request.agent>
  let owner: ReturnType<typeof request.agent>
  let receiver: ReturnType<typeof request.agent>
  let outsider: ReturnType<typeof request.agent>
  let ownerId = ''
  let receiverId = ''
  let productId = ''
  const createdTransferIds: string[] = []

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'staff@test.local')
    staff = s.agent
    const o = await authedActor('CUSTOMER', 'owner@test.local')
    owner = o.agent
    ownerId = o.userId
    const r = await authedActor('CUSTOMER', 'receiver@test.local')
    receiver = r.agent
    receiverId = r.userId
    const x = await authedActor('CUSTOMER', 'outsider@test.local')
    outsider = x.agent

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-anillo-transfer',
      name: 'Anillo Transferible',
      category: 'RING',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  /** Crea pieza nueva + venta + canje para que `buyer` quede como dueño activo. */
  async function createOwnedPiece(buyerId: string) {
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '5.000',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece.body.id,
      buyerId,
      amount: '1500.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)
    const buyer = buyerId === receiverId ? receiver : owner
    const claim = await mutate(buyer, 'post', '/api/v1/claims/redeem', { code: sale.body.claimCode })
    expect(claim.status).toBe(HttpStatus.CREATED)
    return piece.body.id as string
  }

  async function createTransfer(pieceId: string, toUserId: string) {
    const res = await mutate(owner, 'post', '/api/v1/transfers', { pieceId, toUserId })
    expect(res.status).toBe(HttpStatus.CREATED)
    createdTransferIds.push(res.body.id as string)
    return res
  }

  it('protege las rutas de transferencias (401 anónimo y 403 sin permiso)', async () => {
    const anon = await server().get('/api/v1/transfers')
    expect(anon.status).toBe(HttpStatus.UNAUTHORIZED)

    const noRole = await authedActor(null, 'norole@test.local')
    const forbidden = await mutate(noRole.agent, 'post', '/api/v1/transfers', {
      pieceId: '00000000-0000-0000-0000-000000000000',
      toUserId: receiverId
    })
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('no permite transferir una pieza sin dueño activo o inexistente', async () => {
    const noPiece = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId: '00000000-0000-0000-0000-000000000000',
      toUserId: receiverId
    })
    expect(noPiece.status).toBe(HttpStatus.NOT_FOUND)

    const unclaimed = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '5.000',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    const noOwner = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId: unclaimed.body.id,
      toUserId: receiverId
    })
    expect(noOwner.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('solicita una transferencia como dueño y la ve en outgoing/incoming', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const res = await createTransfer(pieceId, receiverId)
    expect(res.body.status).toBe('PENDING')
    expect(res.body.fromUser.email).toBe('owner@test.local')
    expect(res.body.toUser.email).toBe('receiver@test.local')
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS)
    expect(res.body.piece.serialNumber).toMatch(/^NG-2026-/)

    const outgoing = await owner.get('/api/v1/transfers/outgoing')
    expect(outgoing.status).toBe(HttpStatus.OK)
    expect(outgoing.body.total).toBe(1)
    expect(outgoing.body.items[0].id).toBe(res.body.id)

    const incoming = await receiver.get('/api/v1/transfers/incoming')
    expect(incoming.status).toBe(HttpStatus.OK)
    expect(incoming.body.total).toBe(1)
    expect(incoming.body.items[0].id).toBe(res.body.id)
  })

  it('no admite segundas solicitudes PENDING de la misma pieza (409)', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    await createTransfer(pieceId, receiverId)
    const dup = await mutate(owner, 'post', '/api/v1/transfers', { pieceId, toUserId: receiverId })
    expect(dup.status).toBe(HttpStatus.CONFLICT)
  })

  it('rechaza transferencias inválidas (a sí mismo, destinatario inexistente, pieza retirada)', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const toSelf = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: ownerId
    })
    expect(toSelf.status).toBe(HttpStatus.BAD_REQUEST)

    const noTarget = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: '00000000-0000-0000-0000-000000000000'
    })
    expect(noTarget.status).toBe(HttpStatus.NOT_FOUND)

    const toInactive = await createUserWithRole('inactive@test.local', 'CUSTOMER')
    await prisma.users.update({ where: { id: toInactive.id }, data: { status: 'PENDING_VERIFICATION' } })
    const inactive = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: toInactive.id
    })
    expect(inactive.status).toBe(HttpStatus.NOT_FOUND)

    const fresh = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '5.000',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(fresh.status).toBe(HttpStatus.CREATED)
    const retiredRes = await mutate(staff, 'post', `/api/v1/pieces/${fresh.body.id}/retire`)
    expect(retiredRes.status).toBe(HttpStatus.OK)
    const retired = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId: fresh.body.id,
      toUserId: receiverId
    })
    expect(retired.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('acepta la transferencia: cierra el ownership anterior y crea el nuevo (TRANSFER)', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const req = await createTransfer(pieceId, receiverId)
    const transferId = req.body.id as string

    const byOutsider = await mutate(outsider, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(byOutsider.status).toBe(HttpStatus.FORBIDDEN)

    const accepted = await mutate(receiver, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(accepted.status).toBe(HttpStatus.OK)
    expect(accepted.body.status).toBe('ACCEPTED')
    expect(accepted.body.acceptedAt).toBeTypeOf('string')
    expect(accepted.body.toUser.email).toBe('receiver@test.local')

    const ownerships = await prisma.ownership_records.findMany({
      where: { pieceId },
      orderBy: { startDate: 'asc' }
    })
    expect(ownerships).toHaveLength(2)
    expect(ownerships[0].endDate).not.toBeNull()
    expect(ownerships[1].ownerId).toBe(receiverId)
    expect(ownerships[1].acquisitionType).toBe('TRANSFER')
    expect(ownerships[1].transferId).toBe(transferId)
    expect(ownerships[1].endDate).toBeNull()

    const detail = await receiver.get(`/api/v1/pieces/${pieceId}`)
    expect(detail.status).toBe(HttpStatus.OK)
    expect(detail.body.currentOwner.email).toBe('receiver@test.local')

    const oldOwner = await owner.get(`/api/v1/pieces/${pieceId}`)
    expect(oldOwner.status).toBe(HttpStatus.FORBIDDEN)

    const again = await mutate(receiver, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(again.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rechaza la transferencia: la propiedad no cambia de manos', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const req = await createTransfer(pieceId, receiverId)
    const transferId = req.body.id as string

    const rejected = await mutate(receiver, 'post', `/api/v1/transfers/${transferId}/reject`)
    expect(rejected.status).toBe(HttpStatus.OK)
    expect(rejected.body.status).toBe('REJECTED')
    expect(rejected.body.rejectedAt).toBeTypeOf('string')

    const ownerships = await prisma.ownership_records.findMany({ where: { pieceId } })
    expect(ownerships).toHaveLength(1)
    expect(ownerships[0].ownerId).toBe(ownerId)
    expect(ownerships[0].endDate).toBeNull()

    const again = await mutate(receiver, 'post', `/api/v1/transfers/${transferId}/reject`)
    expect(again.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('cancela la transferencia como solicitante (terceros no pueden)', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const req = await createTransfer(pieceId, receiverId)
    const transferId = req.body.id as string

    const byOutsider = await mutate(outsider, 'post', `/api/v1/transfers/${transferId}/cancel`)
    expect(byOutsider.status).toBe(HttpStatus.FORBIDDEN)

    const cancelled = await mutate(owner, 'post', `/api/v1/transfers/${transferId}/cancel`)
    expect(cancelled.status).toBe(HttpStatus.OK)
    expect(cancelled.body.status).toBe('CANCELLED')
    expect(cancelled.body.cancelledAt).toBeTypeOf('string')
  })

  it('no acepta transferencias expiradas y las marca como EXPIRED', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const transfer = await prisma.ownership_transfers.create({
      data: {
        pieceId,
        fromUserId: ownerId,
        toUserId: receiverId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - DAY_MS)
      }
    })

    const expired = await mutate(receiver, 'post', `/api/v1/transfers/${transfer.id}/accept`)
    expect(expired.status).toBe(HttpStatus.BAD_REQUEST)
    expect(expired.body.message).toContain('expirado')

    const record = await prisma.ownership_transfers.findUnique({ where: { id: transfer.id } })
    expect(record?.status).toBe('EXPIRED')
  })

  it('staff puede gestionar transferencias en nombre de los usuarios (transfers:manage)', async () => {
    const pieceId = await createOwnedPiece(ownerId)
    const req = await createTransfer(pieceId, receiverId)
    const transferId = req.body.id as string

    const accepted = await mutate(staff, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(accepted.status).toBe(HttpStatus.OK)
    expect(accepted.body.status).toBe('ACCEPTED')

    const all = await staff.get('/api/v1/transfers')
    expect(all.status).toBe(HttpStatus.OK)
    expect(all.body.total).toBeGreaterThanOrEqual(createdTransferIds.length)
    for (const id of createdTransferIds) {
      expect(all.body.items.map((i: { id: string }) => i.id)).toContain(id)
    }
  })
})