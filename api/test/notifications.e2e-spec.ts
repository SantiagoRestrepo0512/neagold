import 'reflect-metadata'
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { argon2id, hash } from 'argon2'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../dist/app.module'
import { prisma, truncateAll } from '../../prisma/tests/helpers'
import { listenForTests } from './test-server'

const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD = 'Str0ng!Passw0rd'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: [
    'claims:redeem',
    'pieces:read_own',
    'transfers:request',
    'transfers:accept',
    'transfers:reject',
    'notifications:read_own',
    'notifications:update_own',
    'webhooks:manage_own'
  ],
  STAFF: [
    'products:create',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:read_own',
    'sales:create',
    'webhooks:manage',
    'incidents:create',
    'incidents:read'
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

interface CapturedRequest {
  path: string
  headers: http.IncomingHttpHeaders
  rawBody: string
  body: unknown
}

describe('API e2e (notificaciones y webhooks)', () => {
  let app: INestApplication
  let captureServer: http.Server
  let captureUrl = ''
  const captured: CapturedRequest[] = []

  async function startCaptureServer() {
    captureServer = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        captured.push({
          path: req.url ?? '/',
          headers: req.headers,
          rawBody,
          body: rawBody ? (JSON.parse(rawBody) as unknown) : null
        })
        const fail = req.url?.startsWith('/fail')
        res.statusCode = fail ? 500 : 200
        res.end(fail ? 'nope' : 'ok')
      })
    })
    await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve))
    const address = captureServer.address()
    if (typeof address === 'string' || address === null) throw new Error('sin puerto')
    captureUrl = `http://127.0.0.1:${address.port}`
  }

  beforeAll(async () => {
    await truncateAll()
    await seedRbacForTest()
    await startCaptureServer()
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
    await new Promise<void>((resolve) => captureServer?.close(() => resolve()))
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
  let owner: ReturnType<typeof request.agent>
  let recipient: ReturnType<typeof request.agent>
  let outsider: ReturnType<typeof request.agent>
  let ownerId = ''
  let recipientId = ''
  let productId = ''

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'wh-staff@test.local')
    staff = s.agent
    const o = await authedActor('CUSTOMER', 'wh-owner@test.local')
    owner = o.agent
    ownerId = o.userId
    const r = await authedActor('CUSTOMER', 'wh-recipient@test.local')
    recipient = r.agent
    recipientId = r.userId
    const x = await authedActor(null, 'wh-outsider@test.local')
    outsider = x.agent

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-wh-prod',
      name: 'Collar Webhooks',
      category: 'NECKLACE',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  /** Registra pieza, la vende a `buyer` (o ownerId) y el comprador la canjea. */
  async function createOwnedPiece(buyerAgent: ReturnType<typeof request.agent>, buyerId: string) {
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '4.000',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-01-15T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    const sale = await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece.body.id,
      buyerId,
      amount: '900.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)
    const claim = await mutate(buyerAgent, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(claim.status).toBe(HttpStatus.CREATED)
    return piece.body.id as string
  }

  async function createWebhook(agent: ReturnType<typeof request.agent>, url: string, events: string[]) {
    const res = await mutate(agent, 'post', '/api/v1/webhooks', { url, events })
    return res
  }

  async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    let last: T | null = null
    while (Date.now() < deadline) {
      last = await probe()
      if (last !== null) return last
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('timeout esperando condición')
  }

  async function lastDelivery(webhookId: string) {
    const res = await owner.get(`/api/v1/webhooks/${webhookId}/deliveries`)
    if (res.status !== HttpStatus.OK) return null
    const items = res.body.items as Array<{ id: string; eventType: string; status: string; payload: unknown }>
    return items.length > 0 ? (items[0] as { id: string; eventType: string; status: string; payload: unknown }) : null
  }

  it('protege las rutas (401 anónimo y 403 sin permiso)', async () => {
    expect((await server().get('/api/v1/notifications')).status).toBe(HttpStatus.UNAUTHORIZED)
    expect((await server().get('/api/v1/webhooks')).status).toBe(HttpStatus.UNAUTHORIZED)

    const forbidden = await mutate(outsider, 'post', '/api/v1/webhooks', {
      url: captureUrl,
      events: ['transfer.requested']
    })
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('crea un webhook devolviendo el secreto una sola vez y valida la entrada', async () => {
    const created = await createWebhook(owner, captureUrl, ['transfer.requested', 'sale.created'])
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.body.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(created.body.webhook.secret).toBeUndefined()
    const webhookId = created.body.webhook.id as string

    const listed = await owner.get('/api/v1/webhooks')
    expect(listed.status).toBe(HttpStatus.OK)
    expect(listed.body.total).toBeGreaterThanOrEqual(1)
    expect(listed.body.items[0].secret).toBeUndefined()

    const badEvents = await createWebhook(owner, captureUrl, ['not-a-real-event'])
    expect(badEvents.status).toBe(HttpStatus.BAD_REQUEST)

    const badUrl = await createWebhook(owner, 'ftp://nope.local', ['transfer.requested'])
    expect(badUrl.status).toBe(HttpStatus.BAD_REQUEST)

    const emptyEvents = await mutate(owner, 'post', '/api/v1/webhooks', { url: captureUrl, events: [] })
    expect(emptyEvents.status).toBe(HttpStatus.BAD_REQUEST)

    return webhookId
  })

  it('entrega eventos firmados con HMAC-SHA256 al endpoint', async () => {
    let webhookId = ''
    {
      const created = await createWebhook(owner, captureUrl, ['transfer.accepted'])
      expect(created.status).toBe(HttpStatus.CREATED)
      webhookId = created.body.webhook.id as string
    }

    const pieceId = await createOwnedPiece(owner, ownerId)
    const transferReq = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: recipientId
    })
    expect(transferReq.status).toBe(HttpStatus.CREATED)
    const transferId = transferReq.body.id as string

    const accept = await mutate(recipient, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(accept.status).toBe(HttpStatus.OK)

    const delivery = await waitFor(async () => {
      const d = await lastDelivery(webhookId)
      return d && d.status === 'SUCCESS' ? d : null
    })
    expect(delivery.eventType).toBe('transfer.accepted')

    const capturedReq = captured.find((c) => (c.body as { event?: string })?.event === 'transfer.accepted')
    expect(capturedReq).toBeDefined()
    if (!capturedReq) return

    const signature = capturedReq.headers['x-neagold-signature'] as string
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(capturedReq.headers['x-neagold-event']).toBe('transfer.accepted')
    expect(capturedReq.headers['x-neagold-delivery']).toBe(delivery.id)

    const webhook = await prisma.webhooks.findUnique({ where: { id: webhookId } })
    expect(webhook).toBeDefined()
    if (!webhook) return
    const recomputed = createHmac('sha256', webhook.secret).update(capturedReq.rawBody).digest('hex')
    expect(signature).toBe(`sha256=${recomputed}`)
  })

  it('registra envíos fallidos (500) incrementando intentos y failureCount', async () => {
    let webhookId = ''
    {
      const created = await createWebhook(owner, captureUrl, ['transfer.cancelled'])
      expect(created.status).toBe(HttpStatus.CREATED)
      webhookId = created.body.webhook.id as string
    }
    const failing = await prisma.webhooks.update({
      where: { id: webhookId },
      data: { url: `${captureUrl}/fail` }
    })
    expect(failing).toBeDefined()

    const pieceId = await createOwnedPiece(owner, ownerId)
    const transferReq = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: recipientId
    })
    expect(transferReq.status).toBe(HttpStatus.CREATED)
    const cancelled = await mutate(owner, 'post', `/api/v1/transfers/${transferReq.body.id}/cancel`)
    expect(cancelled.status).toBe(HttpStatus.OK)

    const delivery = await waitFor(async () => {
      const d = await lastDelivery(webhookId)
      return d && d.status === 'FAILED' ? d : null
    })
    expect(delivery.eventType).toBe('transfer.cancelled')
    expect(delivery.payload).toBeDefined()

    const webhook = await prisma.webhooks.findUnique({ where: { id: webhookId } })
    expect(webhook?.failureCount).toBeGreaterThanOrEqual(1)

    await prisma.webhooks.update({ where: { id: webhookId }, data: { isActive: true, failureCount: 0 } })
  })

  it('genera notificaciones in-app (transferencia) y permite marcarlas como leídas', async () => {
    await mutate(owner, 'patch', '/api/v1/notifications/read-all')

    const pieceId = await createOwnedPiece(owner, ownerId)
    const transferReq = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: recipientId
    })
    expect(transferReq.status).toBe(HttpStatus.CREATED)
    const transferId = transferReq.body.id as string

    const notif = await waitFor(async () => {
      const res = await recipient.get('/api/v1/notifications')
      if (res.status !== HttpStatus.OK) return null
      const items = res.body.items as Array<{ type: string; readAt: string | null }>
      const pending = items.find((n) => n.type === 'TRANSFER_REQUEST' && n.readAt === null)
      return pending ?? null
    })
    expect(notif.type).toBe('TRANSFER_REQUEST')

    const list = await recipient.get('/api/v1/notifications')
    expect(list.body.unreadCount).toBeGreaterThanOrEqual(1)

    const idRes = await recipient.get('/api/v1/notifications')
    const first = (idRes.body.items as Array<{ id: string }>)[0]
    const marked = await mutate(recipient, 'patch', `/api/v1/notifications/${first.id}/read`)
    expect(marked.status).toBe(HttpStatus.OK)
    expect(marked.body.readAt).toBeTypeOf('string')

    await mutate(recipient, 'patch', '/api/v1/notifications/read-all')
    const afterAll = await recipient.get('/api/v1/notifications?unread=true')
    expect(afterAll.body.unreadCount).toBe(0)
    expect(afterAll.body.total).toBe(0)

    const accept = await mutate(recipient, 'post', `/api/v1/transfers/${transferId}/accept`)
    expect(accept.status).toBe(HttpStatus.OK)
    const senderNotif = await waitFor(async () => {
      const res = await owner.get('/api/v1/notifications')
      if (res.status !== HttpStatus.OK) return null
      const items = res.body.items as Array<{ type: string }>
      return items.find((n) => n.type === 'TRANSFER_ACCEPTED') ?? null
    })
    expect(senderNotif.type).toBe('TRANSFER_ACCEPTED')
  })

  it('avisa al comprador del código de reclamación (sale.created)', async () => {
    const piece = await mutate(staff, 'post', '/api/v1/pieces', {
      productId,
      weightGrams: '3.500',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: '2026-02-01T00:00:00.000Z'
    })
    expect(piece.status).toBe(HttpStatus.CREATED)
    await mutate(staff, 'post', '/api/v1/sales', {
      pieceId: piece.body.id,
      buyerId: ownerId,
      amount: '1200.00'
    })

    const notif = await waitFor(async () => {
      const res = await owner.get('/api/v1/notifications')
      if (res.status !== HttpStatus.OK) return null
      const items = res.body.items as Array<{ type: string }>
      return items.find((n) => n.type === 'CLAIM_AVAILABLE') ?? null
    })
    expect(notif.type).toBe('CLAIM_AVAILABLE')
  })

  it('rota el secreto y elimina el webhook (cascade de deliveries)', async () => {
    const created = await createWebhook(owner, captureUrl, ['claim.redeemed'])
    expect(created.status).toBe(HttpStatus.CREATED)
    const webhookId = created.body.webhook.id as string
    const oldSecret = created.body.secret as string

    const rotated = await mutate(owner, 'post', `/api/v1/webhooks/${webhookId}/secret`)
    expect(rotated.status).toBe(HttpStatus.OK)
    expect(rotated.body.secret).not.toBe(oldSecret)

    const foreign = await owner.get(`/api/v1/webhooks/${webhookId}`)
    expect(foreign.status).toBe(HttpStatus.OK)
    const foreignPatch = await mutate(recipient, 'patch', `/api/v1/webhooks/${webhookId}`)
    expect(foreignPatch.status).toBe(HttpStatus.FORBIDDEN)

    const del = await mutate(owner, 'delete', `/api/v1/webhooks/${webhookId}`)
    expect(del.status).toBe(HttpStatus.OK)
    const deliveriesLeft = await prisma.webhook_deliveries.count({ where: { webhookId } })
    expect(deliveriesLeft).toBe(0)
  })
})