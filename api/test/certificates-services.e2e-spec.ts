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
  CUSTOMER: [
    'pieces:read_own',
    'claims:redeem',
    'certificates:read_own',
    'certificates:download_own',
    'services:request'
  ],
  STAFF: [
    'products:create',
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'certificates:create',
    'certificates:revoke',
    'certificates:read',
    'services:create',
    'services:complete',
    'services:read'
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

async function createUser(email: string, roleName?: string) {
  const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)
  const user = await prisma.users.create({
    data: { email, passwordHash, firstName: roleName ?? 'Sin', lastName: 'Role', status: 'ACTIVE' }
  })
  if (roleName) {
    const role = await prisma.roles.findUnique({ where: { name: roleName } })
    if (role) await prisma.user_roles.create({ data: { userId: user.id, roleId: role.id } })
  }
  return user
}

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

describe('API e2e (certificados y servicios)', () => {
  let app: INestApplication
  let staff: { id: string; email: string }
  let customer: { id: string; email: string }
  let outsider: { id: string; email: string }
  let pieceId: string
  let piece2Id: string

  beforeAll(async () => {
    await truncateAll()
    await seedRbacForTest()
    staff = await createUser('staff@neagold.test', 'STAFF')
    customer = await createUser('customer@neagold.test', 'CUSTOMER')
    outsider = await createUser('outsider@neagold.test')

    const product = await prisma.products.create({
      data: {
        sku: 'PIA-001',
        name: 'Anillo oro',
        category: 'RINGS',
        basePurity: '18k',
        description: null
      }
    })
    const piece = await prisma.jewelry_pieces.create({
      data: {
        productId: product.id,
        internalId: 'NG-INT-2026-0001',
        publicId: `${'A'.repeat(25)}1`,
        serialNumber: 'NG-2026-000001',
        weightGrams: 5.2,
        purity: '18k',
        material: 'oro',
        manufacturingDate: new Date('2026-01-15T00:00:00.000Z'),
        status: 'AVAILABLE'
      }
    })
    const piece2 = await prisma.jewelry_pieces.create({
      data: {
        productId: product.id,
        internalId: 'NG-INT-2026-0002',
        publicId: `${'B'.repeat(25)}2`,
        serialNumber: 'NG-2026-000002',
        weightGrams: 8.1,
        purity: '18k',
        material: 'oro',
        manufacturingDate: new Date('2026-02-20T00:00:00.000Z'),
        status: 'RETIRED'
      }
    })
    pieceId = piece.id
    piece2Id = piece2.id
    await prisma.digital_identities.create({
      data: { pieceId: piece.id, publicToken: 'a'.repeat(64), identityHash: sha256('identity') }
    })
    // El cliente es el propietario actual de la pieza 1.
    await prisma.ownership_records.create({
      data: {
        pieceId: piece.id,
        ownerId: customer.id,
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        acquisitionType: 'FIRST_REGISTRATION',
        createdBy: staff.id
      }
    })

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
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

  async function mutate(
    agent: ReturnType<typeof request.agent>,
    method: 'post' | 'patch' | 'put' | 'delete',
    url: string,
    body?: Record<string, unknown>
  ) {
    const csrf = await agent.get('/api/v1/auth/csrf')
    const req = agent[method](url)
    if (body) req.send(body)
    return req.set('x-csrf-token', csrf.body.csrfToken as string)
  }

  function authenticatedAgent() {
    return makeAgent().then(async ({ agent, csrfToken }) => {
      await loginAgent(agent, csrfToken, staff.email)
      return { agent, csrfToken }
    })
  }

  describe('certificados', () => {
    it('rechaza sin sesión', async () => {
      const res = await server().get('/api/v1/certificates')
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('emite un certificado y devuelve el documento con su hash', async () => {
      const { agent } = await authenticatedAgent()
      const res = await mutate(agent, 'post', '/api/v1/certificates', {
        pieceId,
        type: 'AUTHENTICITY'
      })
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.body.certificate.certificateNumber).toMatch(/^NG-CERT-2026-[0-9A-F]{12}$/)
      expect(res.body.certificate.status).toBe('ACTIVE')
      expect(res.body.certificate.issuedBy.id).toBe(staff.id)
      expect(res.body.certificate.piece.serialNumber).toBe('NG-2026-000001')
      expect(res.body.documentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(res.body.document).toBeTruthy()
      expect(sha256(res.body.document)).toBe(res.body.documentHash)
    })

    it('rechaza emitir para pieza inexistente o sin identidad digital', async () => {
      const { agent } = await authenticatedAgent()
      const missing = await mutate(agent, 'post', '/api/v1/certificates', {
        pieceId: '00000000-0000-4000-8000-000000000000',
        type: 'APPRAISAL'
      })
      expect(missing.status).toBe(HttpStatus.NOT_FOUND)
      const noIdentity = await mutate(agent, 'post', '/api/v1/certificates', {
        pieceId: piece2Id,
        type: 'APPRAISAL'
      })
      expect(noIdentity.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    })

    it('descarga el documento y el hash coincide con el almacenado', async () => {
      const { agent } = await authenticatedAgent()
      const certificate = await prisma.certificates.findFirstOrThrow({
        where: { pieceId },
        select: { id: true, documentHash: true }
      })
      const res = await agent.get(`/api/v1/certificates/${certificate.id}/download`)
      expect(res.status).toBe(HttpStatus.OK)
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['x-document-sha256']).toBe(certificate.documentHash)
      expect(sha256(res.text)).toBe(certificate.documentHash)
    })

    it('aisla el alcance: el cliente solo ve certificados de piezas propias', async () => {
      const { agent, csrfToken } = await makeAgent()
      await loginAgent(agent, csrfToken, customer.email)
      const res = await agent.get('/api/v1/certificates')
      expect(res.status).toBe(HttpStatus.OK)
      expect(res.body.total).toBe(1)
      expect(new Set(res.body.items.map((item: { piece: { id: string } }) => item.piece.id))).toEqual(
        new Set([pieceId])
      )
    })

    it('no permite ver certificados ajenos ni revocar sin permiso', async () => {
      const { agent, csrfToken } = await makeAgent()
      await loginAgent(agent, csrfToken, outsider.email)
      const certificate = await prisma.certificates.findFirstOrThrow({ select: { id: true } })
      const detail = await agent.get(`/api/v1/certificates/${certificate.id}`)
      expect(detail.status).toBe(HttpStatus.FORBIDDEN)
      const revoke = await mutate(agent, 'post', `/api/v1/certificates/${certificate.id}/revoke`)
      expect(revoke.status).toBe(HttpStatus.FORBIDDEN)
    })

    it('revoca un certificado; revocar dos veces falla', async () => {
      const { agent } = await authenticatedAgent()
      const certificate = await prisma.certificates.findFirstOrThrow({ select: { id: true } })
      const revoke = await mutate(agent, 'post', `/api/v1/certificates/${certificate.id}/revoke`)
      expect(revoke.status).toBe(HttpStatus.OK)
      expect(revoke.body.status).toBe('REVOKED')
      expect(revoke.body.revokedAt).toBeTruthy()
      const again = await mutate(agent, 'post', `/api/v1/certificates/${certificate.id}/revoke`)
      expect(again.status).toBe(HttpStatus.BAD_REQUEST)
    })

    it('crea notificación CERTIFICATE_ISSUED para el propietario actual', async () => {
      const notification = await prisma.notifications.findFirst({
        where: { userId: customer.id, type: 'CERTIFICATE_ISSUED' }
      })
      expect(notification).toBeTruthy()
    })
  })

  describe('servicios', () => {
    it('rechaza sin sesión', async () => {
      const res = await server().get('/api/v1/services')
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    })

    it('el cliente solicita un servicio para su pieza', async () => {
      const { agent, csrfToken } = await makeAgent()
      await loginAgent(agent, csrfToken, customer.email)
      const res = await mutate(agent, 'post', '/api/v1/services', {
        pieceId,
        type: 'CLEANING',
        notes: 'limpieza profunda'
      })
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.body.service.status).toBe('REQUESTED')
      expect(res.body.service.requestedBy.id).toBe(customer.id)
      expect(res.body.service.type).toBe('CLEANING')
    })

    it('el staff avanza REQUESTED -> IN_PROGRESS -> COMPLETED', async () => {
      const { agent } = await authenticatedAgent()
      const service = await prisma.service_records.findFirstOrThrow({
        where: { pieceId },
        select: { id: true }
      })
      const start = await mutate(agent, 'post', `/api/v1/services/${service.id}/start`)
      expect(start.status).toBe(HttpStatus.OK)
      expect(start.body.service.status).toBe('IN_PROGRESS')
      expect(start.body.service.performedBy.id).toBe(staff.id)
      const inService = await prisma.jewelry_pieces.findUnique({ where: { id: pieceId } })
      expect(inService?.status).toBe('IN_SERVICE')

      const complete = await mutate(agent, 'post', `/api/v1/services/${service.id}/complete`, {
        notes: 'hecho'
      })
      expect(complete.status).toBe(HttpStatus.OK)
      expect(complete.body.service.status).toBe('COMPLETED')
      expect(complete.body.service.completedAt).toBeTruthy()
      expect(complete.body.service.notes).toBe('hecho')
    })

    it('completar un servicio devuelve la pieza IN_SERVICE a AVAILABLE', async () => {
      const { agent } = await authenticatedAgent()
      await prisma.jewelry_pieces.update({ where: { id: pieceId }, data: { status: 'IN_SERVICE' } })
      const service = await prisma.service_records.create({
        data: { pieceId, type: 'REPAIR', status: 'IN_PROGRESS', performedBy: staff.id }
      })
      const res = await mutate(agent, 'post', `/api/v1/services/${service.id}/complete`)
      expect(res.status).toBe(HttpStatus.OK)
      expect(res.body.service.status).toBe('COMPLETED')
      const piece = await prisma.jewelry_pieces.findUnique({ where: { id: pieceId } })
      expect(piece?.status).toBe('AVAILABLE')
    })

    it('el cliente no puede iniciar servicios y sí cancelar los suyos', async () => {
      const { agent, csrfToken } = await makeAgent()
      await loginAgent(agent, csrfToken, customer.email)
      const service = await prisma.service_records.create({
        data: { pieceId, type: 'INSPECTION', status: 'REQUESTED', requestedBy: customer.id }
      })
      const start = await mutate(agent, 'post', `/api/v1/services/${service.id}/start`)
      expect(start.status).toBe(HttpStatus.FORBIDDEN)
      const cancel = await mutate(agent, 'post', `/api/v1/services/${service.id}/cancel`)
      expect(cancel.status).toBe(HttpStatus.OK)
      expect(cancel.body.service.status).toBe('CANCELLED')
      const again = await mutate(agent, 'post', `/api/v1/services/${service.id}/cancel`)
      expect(again.status).toBe(HttpStatus.BAD_REQUEST)
    })

    it('el cliente sin permiso de lectura no ve servicios de otros', async () => {
      const { agent, csrfToken } = await makeAgent()
      await loginAgent(agent, csrfToken, outsider.email)
      const list = await agent.get('/api/v1/services')
      expect(list.status).toBe(HttpStatus.FORBIDDEN)
    })

    it('notifica SERVICE_COMPLETED al propietario actual', async () => {
      const notification = await prisma.notifications.findFirst({
        where: { userId: customer.id, type: 'SERVICE_COMPLETED' }
      })
      expect(notification).toBeTruthy()
    })
  })
})