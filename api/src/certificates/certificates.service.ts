import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { EventsService } from '../events/events.service'
import { nextYear, sha256 } from '../common/utils/tokens'
import { CreateCertificateDto } from './dto/create-certificate.dto'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

const PIECE_SELECT = {
  id: true,
  internalId: true,
  publicId: true,
  serialNumber: true,
  material: true,
  purity: true,
  weightGrams: true,
  manufacturingDate: true,
  status: true
} satisfies Prisma.jewelry_piecesSelect

const ISSUER_SELECT = { id: true, email: true, firstName: true, lastName: true }

const LIST_INCLUDE = {
  piece: { select: PIECE_SELECT },
  issuer: { select: ISSUER_SELECT }
} satisfies Prisma.certificatesInclude

const DETAIL_INCLUDE = {
  piece: {
    select: {
      ...PIECE_SELECT,
      product: { select: { id: true, sku: true, name: true, category: true, basePurity: true } },
      digitalIdentity: { select: { publicToken: true, identityHash: true, status: true } },
      ownershipRecords: {
        where: { endDate: null },
        orderBy: { startDate: 'desc' },
        take: 1,
        include: { owner: { select: ISSUER_SELECT } }
      }
    }
  },
  issuer: { select: ISSUER_SELECT }
} satisfies Prisma.certificatesInclude

type CertificateDetail = Prisma.certificatesGetPayload<{ include: typeof DETAIL_INCLUDE }>

/**
 * Certificados de autenticidad/aprecio/mantenimiento. El certificado es un
 * documento canónico (JSON con claves ordenadas) cuyo SHA-256 se almacena; la
 * descarga devuelve el mismo documento en claro para que cualquier cliente
 * pueda re-hashear y verificar su integridad.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  async create(dto: CreateCertificateDto, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const piece = await tx.jewelry_pieces.findUnique({
        where: { id: dto.pieceId },
        include: {
          digitalIdentity: true,
          ownershipRecords: {
            where: { endDate: null },
            orderBy: { startDate: 'desc' },
            take: 1,
            include: { owner: { select: ISSUER_SELECT } }
          }
        }
      })
      if (!piece) throw new NotFoundException('Pieza no encontrada')
      if (!piece.digitalIdentity || piece.digitalIdentity.status !== 'ACTIVE') {
        throw new ServiceUnavailableException('La pieza no tiene identidad digital activa')
      }

      const year = nextYear()
      // NG-CERT-{año}-{12 hex}: no toca serial_counters (reservado a seriales y
      // reportes); reintento ante colisión.
      let certificateNumber = ''
      for (let attempt = 0; attempt < 5; attempt++) {
        certificateNumber = newCertificateNumber(year)
        const exists = await tx.certificates.findUnique({
          where: { certificateNumber },
          select: { id: true }
        })
        if (!exists) break
        if (attempt === 4) {
          throw new Error('No se pudo generar un número de certificado único')
        }
      }

      const issuedAt = new Date()
      const document = buildCertificateDocument({
        certificateNumber,
        type: dto.type,
        issuedAt,
        issuedById: actorId,
        serialNumber: piece.serialNumber,
        publicId: piece.publicId,
        material: piece.material,
        purity: piece.purity,
        weightGrams: piece.weightGrams,
        manufacturingDate: piece.manufacturingDate,
        identityPublicToken: piece.digitalIdentity.publicToken,
        identityHash: piece.digitalIdentity.identityHash
      })

      const certificate = await tx.certificates.create({
        data: {
          pieceId: piece.id,
          certificateNumber,
          type: dto.type,
          issuedAt,
          issuedBy: actorId,
          documentHash: sha256(document),
          fileUrl: dto.fileUrl ?? null,
          status: 'ACTIVE'
        }
      })

      return {
        certificate,
        document,
        ownerId: piece.ownershipRecords[0]?.owner?.id ?? null,
        serialNumber: piece.serialNumber
      }
    })

    await this.events.emit('certificate.issued', {
      certificateId: result.certificate.id,
      certificateNumber: result.certificate.certificateNumber,
      pieceId: result.certificate.pieceId,
      serialNumber: result.serialNumber,
      type: dto.type,
      ownerId: result.ownerId
    })

    return {
      certificate: serializeCertificate(await this.load(result.certificate.id)),
      document: result.document,
      documentHash: result.certificate.documentHash
    }
  }

  async list(query: Record<string, unknown>, viewer: { id: string; permissions: string[] }) {
    const limit = Math.min(this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = this.parseIntParam(query['offset'], 0, 0)

    const where: Prisma.certificatesWhereInput = {}
    if (!viewer.permissions.includes('certificates:read')) {
      // Cliente: solo certificados de piezas que posee actualmente.
      where.piece = { ownershipRecords: { some: { ownerId: viewer.id, endDate: null } } }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.certificates.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: offset,
        take: limit,
        include: LIST_INCLUDE
      }),
      this.prisma.certificates.count({ where })
    ])

    return {
      items: items.map((item) => serializeCertificate(item)),
      total: Number(total),
      limit,
      offset
    }
  }

  async findById(id: string, viewer: { id: string; permissions: string[] }) {
    const certificate = await this.load(id)
    if (!this.canView(certificate, viewer)) {
      throw new ForbiddenException('No tienes permiso para ver este certificado')
    }
    return serializeCertificate(certificate)
  }

  /**
   * Documento canónico en claro para verificación de integridad.
   * El hash almacenado se calculó sobre este documento exacto (misma
   * serialización); si la identidad digital de la pieza se regeneró tras la
   * emisión, el re-hasheo no coincidirá, lo que evidencia la modificación.
   */
  async download(id: string, viewer: { id: string; permissions: string[] }) {
    const certificate = await this.load(id)
    if (!this.canView(certificate, viewer)) {
      throw new ForbiddenException('No tienes permiso para descargar este certificado')
    }
    const identity = certificate.piece.digitalIdentity
    if (!identity) {
      throw new ServiceUnavailableException('La pieza no tiene identidad digital')
    }
    const document = buildCertificateDocument({
      certificateNumber: certificate.certificateNumber,
      type: certificate.type,
      issuedAt: certificate.issuedAt,
      issuedById: certificate.issuedBy,
      serialNumber: certificate.piece.serialNumber,
      publicId: certificate.piece.publicId,
      material: certificate.piece.material,
      purity: certificate.piece.purity,
      weightGrams: certificate.piece.weightGrams,
      manufacturingDate: certificate.piece.manufacturingDate,
      identityPublicToken: identity.publicToken,
      identityHash: identity.identityHash
    })
    return { document, documentHash: certificate.documentHash }
  }

  async revoke(id: string) {
    const certificate = await this.load(id)
    if (certificate.status === 'REVOKED') {
      throw new BadRequestException('El certificado ya está revocado')
    }
    await this.prisma.certificates.update({
      where: { id: certificate.id },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })
    return serializeCertificate(await this.load(id))
  }

  private canView(certificate: CertificateDetail, viewer: { id: string; permissions: string[] }) {
    if (viewer.permissions.includes('certificates:read')) return true
    return Boolean(
      certificate.piece.ownershipRecords?.some((record) => record.ownerId === viewer.id)
    )
  }

  private async load(id: string): Promise<CertificateDetail> {
    const certificate = await this.prisma.certificates.findUnique({
      where: { id },
      include: DETAIL_INCLUDE
    })
    if (!certificate) throw new NotFoundException('Certificado no encontrado')
    return certificate
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) {
      throw new BadRequestException('Parámetros de paginación inválidos')
    }
    return value
  }
}

function serializeCertificate(
  certificate: Prisma.certificatesGetPayload<{ include: typeof LIST_INCLUDE }> | CertificateDetail
) {
  return {
    id: certificate.id,
    certificateNumber: certificate.certificateNumber,
    type: certificate.type,
    issuedAt: certificate.issuedAt,
    issuedBy: certificate.issuer,
    documentHash: certificate.documentHash,
    fileUrl: certificate.fileUrl,
    status: certificate.status,
    revokedAt: certificate.revokedAt,
    createdAt: certificate.createdAt,
    piece: certificate.piece
  }
}

export function newCertificateNumber(year: number): string {
  return `NG-CERT-${year}-${randomBytes(6).toString('hex').toUpperCase()}`
}

/* Documento canónico: serialización estable con claves ordenadas en cada
   nivel para que el hash sea determinístico. */
function buildCertificateDocument(input: {
  certificateNumber: string
  type: string
  issuedAt: Date
  issuedById: string
  serialNumber: string
  publicId: string
  material: string
  purity: string
  weightGrams: unknown
  manufacturingDate: Date | string
  identityPublicToken: string
  identityHash: string
}): string {
  const document: Record<string, unknown> = {
    certificateNumber: input.certificateNumber,
    type: input.type,
    issuedAt: input.issuedAt.toISOString(),
    issuedById: input.issuedById,
    piece: {
      publicId: input.publicId,
      serialNumber: input.serialNumber,
      material: input.material,
      purity: input.purity,
      weightGrams: String(input.weightGrams),
      manufacturingDate:
        input.manufacturingDate instanceof Date
          ? input.manufacturingDate.toISOString()
          : String(input.manufacturingDate),
      identity: {
        publicToken: input.identityPublicToken,
        identityHash: input.identityHash
      }
    }
  }
  return stableStringify(document)
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export { buildCertificateDocument }