import { PrismaClient, PieceStatus, UserStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomInt } from 'node:crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL no definida: los tests requieren la variable de entorno')
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
})

export const TABLES = [
  'idempotency_keys',
  'notifications',
  'audit_logs',
  'sales',
  'piece_claim_codes',
  'incident_reports',
  'incidents',
  'certificates',
  'service_records',
  'ownership_transfers',
  'ownership_records',
  'qr_codes',
  'digital_identities',
  'serial_counters',
  'jewelry_pieces',
  'products',
  'mfa_challenges',
  'mfa',
  'login_attempts',
  'sessions',
  'email_verification_tokens',
  'password_reset_tokens',
  'user_roles',
  'role_permissions',
  'permissions',
  'roles',
  'users'
]

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`
  )
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(): string {
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

export async function createUser(email: string, status: UserStatus = 'ACTIVE') {
  return prisma.users.create({
    data: {
      email,
      passwordHash: 'x'.repeat(64),
      firstName: 'Test',
      lastName: 'User',
      status
    }
  })
}

export async function createProduct(sku: string) {
  return prisma.products.create({
    data: { sku, name: `Producto ${sku}`, category: 'RING', basePurity: '18K' }
  })
}

export interface PieceOverrides {
  internalId?: string
  publicId?: string
  status?: PieceStatus
  registeredById?: string
}

export async function createPiece(
  productId: string,
  serialNumber: string,
  overrides: PieceOverrides = {}
) {
  return prisma.jewelry_pieces.create({
    data: {
      productId,
      serialNumber,
      internalId: overrides.internalId ?? `NG-INT-TEST-${serialNumber}`,
      publicId: overrides.publicId ?? ulid(),
      weightGrams: '6.200',
      purity: '18K',
      material: 'GOLD',
      manufacturingDate: new Date('2026-01-15T00:00:00.000Z'),
      status: overrides.status ?? 'IN_STOCK',
      registeredById: overrides.registeredById
    }
  })
}