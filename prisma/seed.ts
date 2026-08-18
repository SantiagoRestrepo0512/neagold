import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { argon2id, hash } from 'argon2'
import { createHash, randomBytes, randomInt } from 'node:crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL no definida: el seed requiere la variable de entorno')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
})

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@neagold.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Neagold_2026!'
const SEED_DEMO = process.env.SEED_DEMO === 'true'

// Parametros OWASP para Argon2id (m=19MiB, t=2, p=1)
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }

const ROLE_NAMES = ['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN'] as const
type RoleName = (typeof ROLE_NAMES)[number]

// ---------------------------------------------------------------------------
// Catálogo de permisos
// ---------------------------------------------------------------------------

const PERMISSIONS: Array<[string, string]> = [
  ['pieces:create', 'Registrar piezas de joyería'],
  ['pieces:read', 'Leer piezas (staff/admin)'],
  ['pieces:read_own', 'Leer piezas propias'],
  ['pieces:update_status', 'Cambiar estado de una pieza'],
  ['pieces:list', 'Listar inventario'],
  ['pieces:retire', 'Retirar piezas del ciclo'],
  ['products:create', 'Crear productos'],
  ['products:read', 'Leer productos'],
  ['products:update', 'Actualizar productos'],
  ['identities:create', 'Crear identidad digital'],
  ['identities:regenerate', 'Regenerar token de identidad'],
  ['qr:create', 'Generar QR'],
  ['qr:revoke', 'Revocar QR'],
  ['qr:regenerate', 'Regenerar QR'],
  ['transfers:request', 'Solicitar transferencia de propiedad'],
  ['transfers:accept', 'Aceptar transferencia'],
  ['transfers:reject', 'Rechazar transferencia'],
  ['transfers:manage', 'Gestionar transferencias (staff)'],
  ['claims:create', 'Generar códigos de reclamación'],
  ['claims:redeem', 'Canjear código de reclamación'],
  ['claims:read', 'Ver códigos de reclamación'],
  ['sales:create', 'Registrar ventas'],
  ['sales:read', 'Leer ventas'],
  ['incidents:create', 'Reportar incidentes'],
  ['incidents:read', 'Leer incidentes (staff)'],
  ['incidents:read_own', 'Leer incidentes propios'],
  ['incidents:recover', 'Marcar pieza como recuperada'],
  ['incidents:review', 'Revisar reportes de incidente'],
  ['incidents:resolve', 'Resolver incidentes'],
  ['certificates:create', 'Emitir certificados'],
  ['certificates:revoke', 'Revocar certificados'],
  ['certificates:read', 'Leer certificados (staff)'],
  ['certificates:read_own', 'Leer certificados propios'],
  ['certificates:download_own', 'Descargar certificados propios'],
  ['services:create', 'Registrar servicios'],
  ['services:complete', 'Completar servicios'],
  ['services:read', 'Leer servicios'],
  ['services:request', 'Solicitar servicios'],
  ['users:read', 'Leer usuarios'],
  ['users:list', 'Listar usuarios'],
  ['users:update_status', 'Actualizar estado de usuarios'],
  ['roles:manage', 'Gestionar roles'],
  ['permissions:manage', 'Gestionar permisos'],
  ['audit:read', 'Leer auditoría'],
  ['notifications:read_own', 'Leer notificaciones propias'],
  ['notifications:update_own', 'Marcar notificaciones propias como leídas'],
  ['webhooks:manage_own', 'Gestionar webhooks propios'],
  ['webhooks:manage', 'Gestionar webhooks (staff)'],
  ['dashboard:staff', 'Acceso al panel operativo']
]

const ROLE_PERMISSIONS: Record<RoleName, string[] | '*'> = {
  CUSTOMER: [
    'pieces:read_own',
    'transfers:request',
    'transfers:accept',
    'transfers:reject',
    'claims:redeem',
    'incidents:create',
    'incidents:read_own',
    'certificates:read_own',
    'certificates:download_own',
    'services:request',
    'notifications:read_own',
    'notifications:update_own',
    'webhooks:manage_own'
  ],
  STAFF: [
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:update_status',
    'pieces:retire',
    'products:create',
    'products:read',
    'products:update',
    'identities:create',
    'identities:regenerate',
    'qr:create',
    'qr:revoke',
    'qr:regenerate',
    'transfers:manage',
    'claims:create',
    'claims:read',
    'sales:create',
    'sales:read',
    'incidents:create',
    'incidents:read',
    'incidents:recover',
    'incidents:review',
    'certificates:create',
    'certificates:revoke',
    'certificates:read',
    'services:create',
    'services:complete',
    'services:read',
    'notifications:read_own',
    'notifications:update_own',
    'webhooks:manage',
    'dashboard:staff'
  ],
  ADMIN: [
    'pieces:create',
    'pieces:read',
    'pieces:list',
    'pieces:update_status',
    'pieces:retire',
    'products:create',
    'products:read',
    'products:update',
    'identities:create',
    'identities:regenerate',
    'qr:create',
    'qr:revoke',
    'qr:regenerate',
    'transfers:manage',
    'claims:create',
    'claims:read',
    'sales:create',
    'sales:read',
    'incidents:create',
    'incidents:read',
    'incidents:recover',
    'incidents:review',
    'incidents:resolve',
    'certificates:create',
    'certificates:revoke',
    'certificates:read',
    'services:create',
    'services:complete',
    'services:read',
    'users:read',
    'users:list',
    'users:update_status',
    'audit:read',
    'notifications:read_own',
    'notifications:update_own',
    'webhooks:manage',
    'dashboard:staff'
  ],
  SUPER_ADMIN: '*'
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function ulid(): string {
  let time = Date.now()
  let prefix = ''
  for (let i = 0; i < 10; i++) {
    prefix = CROCKFORD[time % 32] + prefix
    time = Math.floor(time / 32)
  }
  let random = ''
  for (let i = 0; i < 16; i++) random += CROCKFORD[randomInt(0, 32)]
  return prefix + random
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const newToken = (): string => randomBytes(32).toString('hex')

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

async function seedRbac(): Promise<void> {
  const now = new Date()

  for (const name of ROLE_NAMES) {
    await prisma.roles.upsert({
      where: { name },
      update: {},
      create: { name, description: `Rol ${name}` }
    })
  }

  for (const [code, description] of PERMISSIONS) {
    await prisma.permissions.upsert({ where: { code }, update: {}, create: { code, description } })
  }

  const permissions = await prisma.permissions.findMany()
  const permissionByCode = new Map(permissions.map((p) => [p.code, p.id]))

  for (const name of ROLE_NAMES) {
    const role = await prisma.roles.findUniqueOrThrow({ where: { name } })
    const assigned = ROLE_PERMISSIONS[name] === '*' ? permissions.map((p) => p.code) : ROLE_PERMISSIONS[name]
    await prisma.role_permissions.deleteMany({ where: { roleId: role.id } })
    await prisma.role_permissions.createMany({
      data: assigned.map((code) => ({
        roleId: role.id,
        permissionId: permissionByCode.get(code) as string,
        createdAt: now
      }))
    })
  }
}

async function seedUsers(): Promise<{ admin: { id: string }; staff: { id: string }; customer: { id: string } }> {
  const passwordHash = await hash(ADMIN_PASSWORD, ARGON2_OPTIONS)
  const now = new Date()

  const admin = await prisma.users.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: now },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      status: 'ACTIVE',
      emailVerifiedAt: now
    }
  })
  await ensureRole(admin.id, 'SUPER_ADMIN')

  const staff = await prisma.users.upsert({
    where: { email: 'staff@neagold.local' },
    update: {},
    create: {
      email: 'staff@neagold.local',
      passwordHash,
      firstName: 'Joyero',
      lastName: 'Neagold',
      status: 'ACTIVE',
      emailVerifiedAt: now
    }
  })
  await ensureRole(staff.id, 'STAFF')

  const customer = await prisma.users.upsert({
    where: { email: 'cliente@neagold.local' },
    update: {},
    create: {
      email: 'cliente@neagold.local',
      passwordHash,
      firstName: 'Cliente',
      lastName: 'Demo',
      status: 'ACTIVE',
      emailVerifiedAt: now
    }
  })
  await ensureRole(customer.id, 'CUSTOMER')

  return { admin: { id: admin.id }, staff: { id: staff.id }, customer: { id: customer.id } }
}

async function ensureRole(userId: string, roleName: RoleName): Promise<void> {
  const role = await prisma.roles.findUniqueOrThrow({ where: { name: roleName } })
  await prisma.user_roles.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id }
  })
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

async function nextSerial(year: number): Promise<string> {
  const counter = await prisma.serial_counters.upsert({
    where: { year },
    update: { lastValue: { increment: 1 } },
    create: { year, lastValue: 1 }
  })
  return `NG-${year}-${String(counter.lastValue).padStart(6, '0')}`
}

async function seedDemo(staffId: string, customerId: string): Promise<void> {
  const year = new Date().getUTCFullYear()
  const now = new Date()

  const productDefs = [
    { sku: 'NG-RING-18K-001', name: 'Anillo Solitario 18K', category: 'RING', basePurity: '18K', baseWeightGrams: '6.200' },
    { sku: 'NG-NECK-24K-001', name: 'Collar Oro 24K', category: 'NECKLACE', basePurity: '24K', baseWeightGrams: '14.850' },
    { sku: 'NG-BRACELET-18K-001', name: 'Pulsera Tenis 18K', category: 'BRACELET', basePurity: '18K', baseWeightGrams: '18.300' }
  ]

  const productBySku = new Map<string, string>()
  for (const def of productDefs) {
    const product = await prisma.products.upsert({
      where: { sku: def.sku },
      update: {},
      create: { ...def }
    })
    productBySku.set(def.sku, product.id)
  }

  const pieceDefs = [
    { productSku: 'NG-RING-18K-001', internalId: `NG-INT-${year}-0001`, material: 'GOLD', weight: '6.200', purity: '18K', sold: true },
    { productSku: 'NG-NECK-24K-001', internalId: `NG-INT-${year}-0002`, material: 'GOLD', weight: '14.850', purity: '24K', sold: false },
    { productSku: 'NG-BRACELET-18K-001', internalId: `NG-INT-${year}-0003`, material: 'GOLD', weight: '18.300', purity: '18K', sold: false }
  ]

  let soldPieceId: string | null = null

  for (const def of pieceDefs) {
    const existing = await prisma.jewelry_pieces.findUnique({ where: { internalId: def.internalId } })
    const serialNumber = existing ? existing.serialNumber : await nextSerial(year)

    const piece = await prisma.jewelry_pieces.upsert({
      where: { internalId: def.internalId },
      update: {},
      create: {
        productId: productBySku.get(def.productSku) as string,
        internalId: def.internalId,
        publicId: ulid(),
        serialNumber,
        weightGrams: def.weight,
        purity: def.purity,
        material: def.material,
        manufacturingDate: new Date(`${year}-01-15T00:00:00.000Z`),
        status: def.sold ? 'SOLD' : 'IN_STOCK',
        registeredById: staffId
      }
    })

    const payload = JSON.stringify({
      internalId: piece.internalId,
      serialNumber: piece.serialNumber,
      productSku: def.productSku,
      weightGrams: def.weight,
      purity: def.purity,
      material: def.material,
      manufacturingDate: `${year}-01-15T00:00:00.000Z`
    })

    await prisma.digital_identities.upsert({
      where: { pieceId: piece.id },
      update: {},
      create: {
        pieceId: piece.id,
        publicToken: newToken(),
        identityHash: sha256(payload)
      }
    })

    const qr = await prisma.qr_codes.findFirst({ where: { pieceId: piece.id } })
    if (!qr) {
      await prisma.qr_codes.create({
        data: { pieceId: piece.id, token: newToken(), generatedBy: staffId, generatedAt: now }
      })
    }

    if (def.sold) soldPieceId = piece.id
  }

  if (soldPieceId) {
    const invoiceNumber = `NG-INV-${year}-000001`
    const existingSale = await prisma.sales.findFirst({ where: { pieceId: soldPieceId } })
    if (!existingSale) {
      await prisma.$transaction(async (tx) => {
        const claimCode = `NG-CLAIM-${year}-${randomBytes(16).toString('hex').toUpperCase()}`
        const claim = await tx.piece_claim_codes.create({
          data: {
            pieceId: soldPieceId as string,
            codeHash: sha256(claimCode),
            status: 'USED',
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            createdBy: staffId,
            usedBy: customerId,
            usedAt: now
          }
        })

        await tx.sales.create({
          data: {
            pieceId: soldPieceId as string,
            buyerId: customerId,
            soldBy: staffId,
            amount: '2450.00',
            saleDate: now,
            invoiceNumber,
            claimCode: { connect: { id: claim.id } }
          }
        })

        await tx.ownership_records.deleteMany({ where: { pieceId: soldPieceId as string } })
        await tx.ownership_records.create({
          data: {
            pieceId: soldPieceId as string,
            ownerId: customerId,
            startDate: now,
            acquisitionType: 'CLAIM',
            createdBy: staffId
          }
        })
      })
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await seedRbac()
  const { staff, customer } = await seedUsers()

  if (SEED_DEMO) {
    await seedDemo(staff.id, customer.id)
  }

  console.log(
    `Seed completado: roles=${ROLE_NAMES.length}, permisos=${PERMISSIONS.length}, demo=${SEED_DEMO ? 'si' : 'no'}`
  )
}

main()
  .catch((error) => {
    console.error('Seed fallido:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })