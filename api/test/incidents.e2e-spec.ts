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
  CUSTOMER: ['claims:redeem', 'pieces:read_own', 'transfers:request', 'incidents:create', 'incidents:read_own'],
  STAFF: [
    'products:create',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:read_own',
    'sales:create',
    'incidents:create',
    'incidents:read',
    'incidents:review',
    'incidents:recover',
    'incidents:resolve'
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

describe('API e2e (incidentes: robo/pérdida)', () => {
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
  let owner: ReturnType<typeof request.agent>
  let outsider: ReturnType<typeof request.agent>
  let ownerId = ''
  let productId = ''
  const incidentIds: string[] = []

  beforeAll(async () => {
    const s = await authedActor('STAFF', 'inc-staff@test.local')
    staff = s.agent
    const o = await authedActor('CUSTOMER', 'inc-owner@test.local')
    owner = o.agent
    ownerId = o.userId
    const x = await authedActor(null, 'inc-outsider@test.local')
    outsider = x.agent

    const product = await mutate(staff, 'post', '/api/v1/products', {
      sku: 'ng-inc-prod',
      name: 'Collar Incidentes',
      category: 'NECKLACE',
      basePurity: '18K'
    })
    expect(product.status).toBe(HttpStatus.CREATED)
    productId = product.body.id as string
  }, 60000)

  /** Crea pieza + venta + canje para que el owner quede como dueño activo. */
  async function createOwnedPiece() {
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
      buyerId: ownerId,
      amount: '900.00'
    })
    expect(sale.status).toBe(HttpStatus.CREATED)
    const claim = await mutate(owner, 'post', '/api/v1/claims/redeem', {
      code: sale.body.claimCode
    })
    expect(claim.status).toBe(HttpStatus.CREATED)
    return { pieceId: piece.body.id as string, verifyUrl: piece.body.verifyUrl as string }
  }

  async function reportStolen(pieceId: string, type: 'STOLEN' | 'LOST' = 'STOLEN') {
    const res = await mutate(owner, 'post', '/api/v1/incidents', {
      pieceId,
      type,
      description: 'Robo con violencia',
      details: 'Ocurrió en la plaza central'
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    incidentIds.push(res.body.id as string)
    return res
  }

  it('protege las rutas de incidentes (401 anónimo y 403 sin permiso)', async () => {
    const anon = await server().get('/api/v1/incidents')
    expect(anon.status).toBe(HttpStatus.UNAUTHORIZED)

    const forbidden = await mutate(outsider, 'post', '/api/v1/incidents', {
      pieceId: '00000000-0000-0000-0000-000000000000',
      type: 'STOLEN'
    })
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('reporta un robo: crea incidente + reporte y marca la pieza REPORTED_STOLEN', async () => {
    const { pieceId } = await createOwnedPiece()
    const res = await reportStolen(pieceId)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.type).toBe('STOLEN')
    expect(res.body.reportedBy.email).toBe('inc-owner@test.local')
    expect(res.body.piece.status).toBe('REPORTED_STOLEN')
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.reports[0].reportNumber).toMatch(/^NG-REP-2026-\d{6}$/)
    expect(res.body.reports[0].status).toBe('SUBMITTED')

    const detail = await owner.get(`/api/v1/incidents/${res.body.id}`)
    expect(detail.status).toBe(HttpStatus.OK)
    expect(detail.body.reports[0].reportNumber).toBe(res.body.reports[0].reportNumber)

    const piece = await owner.get(`/api/v1/pieces/${pieceId}`)
    expect(piece.status).toBe(HttpStatus.OK)
    expect(piece.body.status).toBe('REPORTED_STOLEN')

    const dup = await mutate(owner, 'post', '/api/v1/incidents', { pieceId, type: 'LOST' })
    expect(dup.status).toBe(HttpStatus.CONFLICT)
  })

  it('un incidente abierto bloquea la transferencia de la pieza', async () => {
    const { pieceId } = await createOwnedPiece()
    await reportStolen(pieceId, 'LOST')

    const transfer = await mutate(owner, 'post', '/api/v1/transfers', {
      pieceId,
      toUserId: ownerId
    })
    expect(transfer.status).toBe(HttpStatus.BAD_REQUEST)
    expect(transfer.body.message).toContain('incidente')
  })

  it('valida la entrada (pieza inexistente y tipo inválido)', async () => {
    const noPiece = await mutate(owner, 'post', '/api/v1/incidents', {
      pieceId: '00000000-0000-0000-0000-000000000000',
      type: 'STOLEN'
    })
    expect(noPiece.status).toBe(HttpStatus.NOT_FOUND)

    const badType = await mutate(owner, 'post', '/api/v1/incidents', {
      pieceId: productId,
      type: 'NOPE'
    })
    expect(badType.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('no permite reportar incidentes ajenos ni verlos sin permiso', async () => {
    const { pieceId } = await createOwnedPiece()
    await reportStolen(pieceId)

    const other = await authedActor('CUSTOMER', 'inc-other@test.local')
    const foreign = await mutate(other.agent, 'post', '/api/v1/incidents', {
      pieceId,
      type: 'STOLEN'
    })
    expect(foreign.status).toBe(HttpStatus.FORBIDDEN)

    const foreignDetail = await other.agent.get(`/api/v1/incidents/${incidentIds[incidentIds.length - 1]}`)
    expect(foreignDetail.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('permite añadir reportes de seguimiento al incidente propio', async () => {
    const { pieceId } = await createOwnedPiece()
    const incident = await reportStolen(pieceId)

    const added = await mutate(owner, 'post', `/api/v1/incidents/${incident.body.id}/reports`, {
      details: 'Cámara captó al sospechoso'
    })
    expect(added.status).toBe(HttpStatus.CREATED)
    expect(added.body.reports).toHaveLength(2)
    const second = added.body.reports[0]
    expect(second.details).toBe('Cámara captó al sospechoso')
    expect(second.reportNumber).not.toBe(incident.body.reports[0].reportNumber)

    const resolved = await mutate(staff, 'post', `/api/v1/incidents/${incident.body.id}/recover`)
    expect(resolved.status).toBe(HttpStatus.OK)
    const afterResolve = await mutate(owner, 'post', `/api/v1/incidents/${incident.body.id}/reports`, {
      details: 'Intento tardío'
    })
    expect(afterResolve.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('staff revisa, recupera y el dueño vuelve a ver su pieza disponible', async () => {
    const { pieceId } = await createOwnedPiece()
    const incident = await reportStolen(pieceId)
    const incidentId = incident.body.id as string

    const reviewed = await mutate(staff, 'post', `/api/v1/incidents/${incidentId}/review`)
    expect(reviewed.status).toBe(HttpStatus.OK)
    expect(reviewed.body.status).toBe('UNDER_REVIEW')
    expect(reviewed.body.reports.every((r: { status: string }) => r.status === 'VERIFIED')).toBe(true)

    const recovered = await mutate(staff, 'post', `/api/v1/incidents/${incidentId}/recover`)
    expect(recovered.status).toBe(HttpStatus.OK)
    expect(recovered.body.status).toBe('RECOVERED')
    expect(recovered.body.resolvedAt).toBeTypeOf('string')

    const piece = await owner.get(`/api/v1/pieces/${pieceId}`)
    expect(piece.status).toBe(HttpStatus.OK)
    expect(piece.body.status).toBe('AVAILABLE')
  })

  it('staff puede resolver un incidente de forma administrativa', async () => {
    const { pieceId } = await createOwnedPiece()
    const incident = await reportStolen(pieceId)
    const incidentId = incident.body.id as string

    const resolved = await mutate(staff, 'post', `/api/v1/incidents/${incidentId}/resolve`)
    expect(resolved.status).toBe(HttpStatus.OK)
    expect(resolved.body.status).toBe('RESOLVED')

    const again = await mutate(staff, 'post', `/api/v1/incidents/${incidentId}/recover`)
    expect(again.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('lista incidentes propios y todos como staff (con filtros de estado)', async () => {
    const mine = await owner.get('/api/v1/incidents')
    expect(mine.status).toBe(HttpStatus.OK)
    expect(mine.body.total).toBe(incidentIds.length)

    const all = await staff.get('/api/v1/incidents')
    expect(all.status).toBe(HttpStatus.OK)
    expect(all.body.total).toBeGreaterThanOrEqual(incidentIds.length)

    const activeFiltered = await staff.get('/api/v1/incidents?status=ACTIVE')
    expect(activeFiltered.status).toBe(HttpStatus.OK)
    expect(activeFiltered.body.items.every((i: { status: string }) => i.status === 'ACTIVE')).toBe(true)
  })

  it('dos reportes concurrentes de la misma pieza: solo uno crea el incidente (409)', async () => {
    const { pieceId } = await createOwnedPiece()
    const csrf = await owner.get('/api/v1/auth/csrf')
    const body = { pieceId, type: 'STOLEN', description: 'Doble reporte concurrente' }
    const [a, b] = await Promise.all([
      owner.post('/api/v1/incidents').set('x-csrf-token', csrf.body.csrfToken).send(body),
      owner.post('/api/v1/incidents').set('x-csrf-token', csrf.body.csrfToken).send(body)
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT])
    const loser = a.status === HttpStatus.CONFLICT ? a : b
    expect(loser.body.message).toBe('La pieza ya tiene un incidente abierto')
    const count = await prisma.incidents.count({ where: { pieceId } })
    expect(count).toBe(1)
  }, 30000)
})