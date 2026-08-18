import { beforeAll, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createPiece, createProduct, createUser, prisma, truncateAll, ulid } from './helpers'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const newToken = (): string => randomBytes(32).toString('hex')

// Devuelve el código de error de PostgreSQL (23505, 23514, 22P02, P0001, 23503...)
// tal como lo expone Prisma en errores de queries raw (meta.code).
// Con @prisma/adapter-pg los errores raw llegan como DriverAdapterError con
// el SQLSTATE en cause.code (el shape meta.code es del query engine).
function dbErrorCode(error: unknown): string {
  const e = error as {
    meta?: { code?: string }
    code?: string
    cause?: { code?: string }
    message?: string
  }
  return e.meta?.code ?? e.code ?? e.cause?.code ?? String(e.message ?? '')
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? '')
}

async function expectDbError(promise: Promise<unknown>, pgCode: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error) => dbErrorCode(error) === pgCode || messageOf(error).includes(pgCode)
  )
}

beforeAll(async () => {
  await truncateAll()
}, 60000)

describe('Unicidad', () => {
  it('rechaza email duplicado', async () => {
    await createUser('dup-email@test.local')
    await expect(createUser('dup-email@test.local')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rechaza SKU de producto duplicado', async () => {
    await createProduct('SKU-DUP-1')
    await expect(createProduct('SKU-DUP-1')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rechaza serial_number duplicado', async () => {
    const product = await createProduct('SKU-SER-1')
    await createPiece(product.id, 'NG-2026-999901')
    await expect(createPiece(product.id, 'NG-2026-999901')).rejects.toMatchObject({
      code: 'P2002'
    })
  })

  it('rechaza internal_id duplicado', async () => {
    const product = await createProduct('SKU-INT-1')
    await createPiece(product.id, 'NG-2026-999902')
    await expect(
      createPiece(product.id, 'NG-2026-999903', { internalId: 'NG-INT-TEST-NG-2026-999902' })
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rechaza public_id duplicado', async () => {
    const product = await createProduct('SKU-PUB-1')
    const sharedPublicId = ulid()
    await createPiece(product.id, 'NG-2026-999904', { publicId: sharedPublicId })
    await expect(
      createPiece(product.id, 'NG-2026-999905', { publicId: sharedPublicId })
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rechaza public_token duplicado de identidad digital', async () => {
    const product = await createProduct('SKU-IDT-1')
    const pieceA = await createPiece(product.id, 'NG-2026-999910')
    const pieceB = await createPiece(product.id, 'NG-2026-999911')
    const token = newToken()

    await prisma.$executeRaw`
      INSERT INTO "digital_identities"
        ("id", "piece_id", "public_token", "identity_hash", "status", "created_at", "updated_at")
      VALUES
        (${randomUUID()}::uuid, ${pieceA.id}::uuid, ${token}, ${sha256('payload-a')}, 'ACTIVE', now(), now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "digital_identities"
          ("id", "piece_id", "public_token", "identity_hash", "status", "created_at", "updated_at")
        VALUES
          (${randomUUID()}::uuid, ${pieceB.id}::uuid, ${token}, ${sha256('payload-b')}, 'ACTIVE', now(), now())`,
      '23505'
    )
  })

  it('rechaza token de QR duplicado', async () => {
    const product = await createProduct('SKU-QR-1')
    const pieceA = await createPiece(product.id, 'NG-2026-999912')
    const pieceB = await createPiece(product.id, 'NG-2026-999913')
    const token = newToken()

    await prisma.$executeRaw`
      INSERT INTO "qr_codes" ("id", "piece_id", "token", "status", "created_at")
      VALUES (${randomUUID()}::uuid, ${pieceA.id}::uuid, ${token}, 'ACTIVE', now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "qr_codes" ("id", "piece_id", "token", "status", "created_at")
        VALUES (${randomUUID()}::uuid, ${pieceB.id}::uuid, ${token}, 'ACTIVE', now())`,
      '23505'
    )
  })

  it('rechaza certificate_number duplicado', async () => {
    const product = await createProduct('SKU-CERT-1')
    const staff = await createUser('cert-staff@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999914')

    await prisma.$executeRaw`
      INSERT INTO "certificates"
        ("id", "piece_id", "certificate_number", "type", "issued_at", "issued_by", "document_hash", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, 'NG-CERT-0001', 'AUTHENTICITY', now(), ${staff.id}::uuid, ${sha256(piece.id)}, now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "certificates"
          ("id", "piece_id", "certificate_number", "type", "issued_at", "issued_by", "document_hash", "created_at")
        VALUES
          (${randomUUID()}::uuid, ${piece.id}::uuid, 'NG-CERT-0001', 'AUTHENTICITY', now(), ${staff.id}::uuid, ${sha256(piece.id)}, now())`,
      '23505'
    )
  })
})

describe('Integridad referencial', () => {
  it('no permite borrar un usuario con historial de propiedad', async () => {
    const product = await createProduct('SKU-FK-1')
    const user = await createUser('fk-owner@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999920', { registeredById: user.id })

    await prisma.$executeRaw`
      INSERT INTO "ownership_records"
        ("id", "piece_id", "owner_id", "start_date", "acquisition_type", "created_by", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${user.id}::uuid, now(), 'FIRST_REGISTRATION', ${user.id}::uuid, now())`

    await expectDbError(
      prisma.users.delete({ where: { id: user.id } }) as unknown as Promise<unknown>,
      '23001'
    )
  })

  it('no permite borrar un producto con piezas asociadas', async () => {
    const product = await createProduct('SKU-FK-2')
    await createPiece(product.id, 'NG-2026-999921')

    await expectDbError(
      prisma.products.delete({ where: { id: product.id } }) as unknown as Promise<unknown>,
      '23001'
    )
  })
})

describe('Invariantes de negocio', () => {
  it('permite solo una transferencia PENDING por pieza (partial unique index)', async () => {
    const product = await createProduct('SKU-INV-1')
    const fromUser = await createUser('transfer-from-1@test.local')
    const toUserA = await createUser('transfer-to-a@test.local')
    const toUserB = await createUser('transfer-to-b@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999930')

    await prisma.$executeRaw`
      INSERT INTO "ownership_transfers"
        ("id", "piece_id", "from_user_id", "to_user_id", "status", "expires_at", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${fromUser.id}::uuid, ${toUserA.id}::uuid, 'PENDING',
         now() + interval '7 days', now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "ownership_transfers"
          ("id", "piece_id", "from_user_id", "to_user_id", "status", "expires_at", "created_at")
        VALUES
          (${randomUUID()}::uuid, ${piece.id}::uuid, ${fromUser.id}::uuid, ${toUserB.id}::uuid, 'PENDING',
           now() + interval '7 days', now())`,
      '23505'
    )
  })

  it('permite una segunda transferencia PENDING una vez resuelta la primera', async () => {
    const product = await createProduct('SKU-INV-2')
    const fromUser = await createUser('transfer-from-2@test.local')
    const toUserA = await createUser('transfer-to-c@test.local')
    const toUserB = await createUser('transfer-to-d@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999931')

    await prisma.$executeRaw`
      INSERT INTO "ownership_transfers"
        ("id", "piece_id", "from_user_id", "to_user_id", "status", "expires_at", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${fromUser.id}::uuid, ${toUserA.id}::uuid, 'PENDING',
         now() + interval '7 days', now())`

    await prisma.$executeRaw`
      UPDATE "ownership_transfers" SET "status" = 'ACCEPTED' WHERE "piece_id" = ${piece.id}::uuid`

    const insert = prisma.$executeRaw`
      INSERT INTO "ownership_transfers"
        ("id", "piece_id", "from_user_id", "to_user_id", "status", "expires_at", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${fromUser.id}::uuid, ${toUserB.id}::uuid, 'PENDING',
         now() + interval '7 days', now())`

    await expect(insert).resolves.not.toThrow()
  })

  it('impide que una pieza tenga dos propietarios activos (trigger)', async () => {
    const product = await createProduct('SKU-INV-3')
    const ownerA = await createUser('active-owner-a@test.local')
    const ownerB = await createUser('active-owner-b@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999932')

    await prisma.$executeRaw`
      INSERT INTO "ownership_records"
        ("id", "piece_id", "owner_id", "start_date", "acquisition_type", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${ownerA.id}::uuid, now(), 'FIRST_REGISTRATION', now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "ownership_records"
          ("id", "piece_id", "owner_id", "start_date", "acquisition_type", "created_at")
        VALUES
          (${randomUUID()}::uuid, ${piece.id}::uuid, ${ownerB.id}::uuid, now(), 'SALE', now())`,
      'P0001'
    )
  })

  it('rechaza end_date anterior a start_date (CHECK chk_ownership_date_range)', async () => {
    const product = await createProduct('SKU-INV-4')
    const owner = await createUser('date-owner@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999933', { status: 'SOLD' })

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "ownership_records"
          ("id", "piece_id", "owner_id", "start_date", "end_date", "acquisition_type", "created_at")
        VALUES
          (${randomUUID()}::uuid, ${piece.id}::uuid, ${owner.id}::uuid,
           now() - interval '10 days', now() - interval '20 days', 'TRANSFER', now())`,
      '23514'
    )
  })

  it('rechaza un valor de enum inválido al insertar una pieza', async () => {
    const product = await createProduct('SKU-ENUM-1')
    const staff = await createUser('enum-staff@test.local')

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "jewelry_pieces"
          ("id", "product_id", "internal_id", "public_id", "serial_number", "weight_grams",
           "purity", "material", "manufacturing_date", "status", "registered_by_id", "created_at", "updated_at")
        VALUES
          (${randomUUID()}::uuid, ${product.id}::uuid, 'NG-INT-ENUM-1', ${ulid()}, 'NG-2026-999940', '6.200',
           '18K', 'GOLD', now(), 'BOGUS', ${staff.id}::uuid, now(), now())`,
      '22P02'
    )
  })

  it('impide vender dos veces la misma pieza', async () => {
    const product = await createProduct('SKU-SALE-1')
    const buyer = await createUser('sale-buyer@test.local')
    const seller = await createUser('sale-seller@test.local')
    const piece = await createPiece(product.id, 'NG-2026-999941')

    await prisma.$executeRaw`
      INSERT INTO "sales"
        ("id", "piece_id", "buyer_id", "sold_by", "amount", "sale_date", "invoice_number", "created_at")
      VALUES
        (${randomUUID()}::uuid, ${piece.id}::uuid, ${buyer.id}::uuid, ${seller.id}::uuid, 1200.00, now(), 'NG-INV-2026-0001', now())`

    await expectDbError(
      prisma.$executeRaw`
        INSERT INTO "sales"
          ("id", "piece_id", "buyer_id", "sold_by", "amount", "sale_date", "invoice_number", "created_at")
        VALUES
          (${randomUUID()}::uuid, ${piece.id}::uuid, ${buyer.id}::uuid, ${seller.id}::uuid, 1200.00, now(), 'NG-INV-2026-0002', now())`,
      '23505'
    )
  })
})

describe('Seed', () => {
  it('es idempotente: dos ejecuciones no duplican datos', async () => {
    await truncateAll()
    execSync('npm run db:test:seed', { stdio: 'pipe' })
    execSync('npm run db:test:seed', { stdio: 'pipe' })

    const roles = await prisma.roles.count()
    expect(roles).toBe(4)

    const permissions = await prisma.permissions.count()
    expect(permissions).toBe(49)

    const adminCount = await prisma.users.count({ where: { email: 'admin@neagold.local' } })
    expect(adminCount).toBe(1)

    const registrations = await prisma.products.count()
    expect(registrations).toBe(3)

    const pieces = await prisma.jewelry_pieces.count()
    expect(pieces).toBe(3)

    const identities = await prisma.digital_identities.count()
    expect(identities).toBe(3)

    const activeOwnerships = await prisma.ownership_records.count({ where: { endDate: null } })
    expect(activeOwnerships).toBe(1)
  }, 120000)
})