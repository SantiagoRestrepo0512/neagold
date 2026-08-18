import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PieceStatus, Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { formatSerial, newToken, nextYear, sha256 } from '../common/utils/tokens'
import { ulid } from '../common/utils/ulid'
import type { EnvConfig } from '../config/env.validation'
import { RegisterPieceDto } from './dto/register-piece.dto'

/**
 * Transiciones de estado permitidas manualmente (staff).
 * SOLD solo puede alcanzarse vía el flujo de venta; los estados de
 * incidente se gestionan desde el módulo de incidentes.
 */
const ALLOWED_TRANSITIONS: Record<PieceStatus, PieceStatus[]> = {
  IN_STOCK: ['AVAILABLE', 'IN_SERVICE', 'RETIRED'],
  AVAILABLE: ['IN_STOCK', 'IN_SERVICE', 'RETIRED'],
  IN_SERVICE: ['IN_STOCK', 'AVAILABLE'],
  SOLD: [],
  REPORTED_STOLEN: [],
  LOST: [],
  RETIRED: []
}

const PIECE_DETAIL_INCLUDE = {
  product: true,
  digitalIdentity: true,
  qrCodes: {
    orderBy: { createdAt: 'desc' as const },
    take: 1
  },
  ownershipRecords: {
    orderBy: { startDate: 'desc' as const },
    take: 1,
    include: { owner: { select: { id: true, email: true, firstName: true, lastName: true } } }
  }
} satisfies Prisma.jewelry_piecesInclude

type PieceDetail = Prisma.jewelry_piecesGetPayload<{ include: typeof PIECE_DETAIL_INCLUDE }>

export interface PieceListQuery {
  status?: PieceStatus
  search?: string
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

@Injectable()
export class PiecesService {
  private readonly publicBaseUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<EnvConfig, true>
  ) {
    this.publicBaseUrl = config.get('publicBaseUrl', { infer: true })
  }

  private verifyUrl(publicToken: string): string {
    return new URL(`/verify/${publicToken}`, this.publicBaseUrl).toString()
  }

  async register(dto: RegisterPieceDto, actorId: string) {
    const year = nextYear()
    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.serial_counters.upsert({
        where: { year },
        update: { lastValue: { increment: 1 } },
        create: { year, lastValue: 1 }
      })
      const serialNumber = formatSerial(year, counter.lastValue)

      const internalId = dto.internalId ?? `NG-INT-${year}-${String(counter.lastValue).padStart(4, '0')}`
      const publicId = ulid()

      const piece = await tx.jewelry_pieces.create({
        data: {
          productId: dto.productId,
          internalId,
          publicId,
          serialNumber,
          weightGrams: dto.weightGrams,
          purity: dto.purity,
          material: dto.material,
          manufacturingDate: new Date(dto.manufacturingDate),
          status: 'IN_STOCK',
          registeredById: actorId
        }
      })

      const identityPayload = JSON.stringify({
        internalId: piece.internalId,
        serialNumber: piece.serialNumber,
        weightGrams: piece.weightGrams.toString(),
        purity: piece.purity,
        material: piece.material,
        manufacturingDate: piece.manufacturingDate.toISOString(),
        productId: piece.productId
      })

      const identity = await tx.digital_identities.create({
        data: {
          pieceId: piece.id,
          publicToken: newToken(),
          identityHash: sha256(identityPayload)
        }
      })

      const qr = await tx.qr_codes.create({
        data: { pieceId: piece.id, token: newToken(), generatedBy: actorId }
      })

      this.audit.record(actorId, {
        action: AuditAction.PIECE_REGISTERED,
        entityType: 'piece',
        entityId: piece.id,
        metadata: { serialNumber: piece.serialNumber }
      })

      return {
        ...piece,
        identityHash: identity.identityHash,
        verifyUrl: this.verifyUrl(identity.publicToken),
        qrToken: qr.token
      }
    })
  }

  async findById(id: string, viewer: { id: string; permissions: string[] }) {
    const piece = await this.prisma.jewelry_pieces.findUnique({
      where: { id },
      include: PIECE_DETAIL_INCLUDE
    })
    if (!piece) throw new NotFoundException('Pieza no encontrada')

    const canReadAll = viewer.permissions.includes('pieces:read')
    if (!canReadAll) {
      const isOwner = piece.ownershipRecords.some((record) => record.ownerId === viewer.id)
      if (!viewer.permissions.includes('pieces:read_own') || !isOwner) {
        throw new ForbiddenException('No tienes permiso para ver esta pieza')
      }
    }

    return serializePieceDetail(piece)
  }

  async list(query: PieceListQuery, viewer: { id: string; permissions: string[] }) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)

    const where: Prisma.jewelry_piecesWhereInput = {}
    if (query.status) where.status = query.status
    if (query.search) {
      where.OR = [
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { internalId: { contains: query.search, mode: 'insensitive' } },
        { publicId: { contains: query.search, mode: 'insensitive' } },
        { product: { sku: { contains: query.search, mode: 'insensitive' } } }
      ]
    }

    const canListAll = viewer.permissions.includes('pieces:list')
    const isOwnerOnly = !canListAll && viewer.permissions.includes('pieces:read_own')
    if (isOwnerOnly) {
      where.ownershipRecords = { some: { ownerId: viewer.id } }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.jewelry_pieces.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          internalId: true,
          publicId: true,
          serialNumber: true,
          weightGrams: true,
          purity: true,
          material: true,
          status: true,
          manufacturingDate: true,
          createdAt: true,
          product: { select: { id: true, sku: true, name: true } }
        }
      }),
      this.prisma.jewelry_pieces.count({ where })
    ])

    return { items, total: Number(total), limit, offset }
  }

  async updateStatus(id: string, status: PieceStatus, actorId: string) {
    const piece = await this.prisma.jewelry_pieces.findUnique({ where: { id } })
    if (!piece) throw new NotFoundException('Pieza no encontrada')

    if (piece.status === status) return this.requireDetail(id)

    const allowed = ALLOWED_TRANSITIONS[piece.status]
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Transición no permitida de ${piece.status} a ${status}. Usa el flujo de venta para marcar una pieza como vendida.`
      )
    }

    const updated = await this.prisma.jewelry_pieces.update({
      where: { id },
      data: { status }
    })
    this.audit.record(actorId, {
      action: AuditAction.PIECE_STATUS_CHANGED,
      entityType: 'piece',
      entityId: id,
      metadata: { from: piece.status, to: status }
    })
    return updated
  }

  async retire(id: string, actorId: string) {
    const piece = await this.prisma.jewelry_pieces.findUnique({ where: { id } })
    if (!piece) throw new NotFoundException('Pieza no encontrada')
    if (
      piece.status === 'SOLD' ||
      piece.status === 'REPORTED_STOLEN' ||
      piece.status === 'LOST' ||
      piece.status === 'RETIRED'
    ) {
      throw new BadRequestException(`No se puede retirar una pieza en estado ${piece.status}`)
    }
    const updated = await this.prisma.jewelry_pieces.update({
      where: { id },
      data: { status: 'RETIRED' }
    })
    this.audit.record(actorId, {
      action: AuditAction.PIECE_RETIRED,
      entityType: 'piece',
      entityId: id,
      metadata: { from: piece.status }
    })
    return updated
  }

  async regenerateQr(id: string, actorId: string) {
    const piece = await this.prisma.jewelry_pieces.findUnique({
      where: { id },
      include: { digitalIdentity: true }
    })
    if (!piece) throw new NotFoundException('Pieza no encontrada')
    if (!piece.digitalIdentity || piece.digitalIdentity.status !== 'ACTIVE') {
      throw new BadRequestException('La pieza no tiene identidad digital activa')
    }
    const publicToken = piece.digitalIdentity.publicToken

    return this.prisma.$transaction(async (tx) => {
      await tx.qr_codes.updateMany({
        where: { pieceId: id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'QR_REGENERATED' }
      })
      const qr = await tx.qr_codes.create({
        data: { pieceId: id, token: newToken(), generatedBy: actorId }
      })
      this.audit.record(actorId, {
        action: AuditAction.QR_REGENERATED,
        entityType: 'piece',
        entityId: id
      })
      return {
        qrToken: qr.token,
        verifyUrl: this.verifyUrl(publicToken),
        previousRevoked: true
      }
    })
  }

  parseListQuery(query: Record<string, unknown>): PieceListQuery {
    let status: PieceStatus | undefined
    if (typeof query['status'] === 'string' && (Object.values(PieceStatus) as string[]).includes(query['status'])) {
      status = query['status'] as PieceStatus
    }
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    const search =
      typeof query['search'] === 'string' && query['search'].trim() ? query['search'].trim() : undefined
    return { status, search, limit, offset }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }

  private async requireDetail(id: string) {
    const piece = await this.prisma.jewelry_pieces.findUnique({
      where: { id },
      include: PIECE_DETAIL_INCLUDE
    })
    if (!piece) throw new NotFoundException('Pieza no encontrada')
    return serializePieceDetail(piece)
  }
}

function serializePieceDetail(piece: PieceDetail) {
  const activeQr = piece.qrCodes[0]
  return {
    id: piece.id,
    internalId: piece.internalId,
    publicId: piece.publicId,
    serialNumber: piece.serialNumber,
    weightGrams: piece.weightGrams,
    purity: piece.purity,
    material: piece.material,
    manufacturingDate: piece.manufacturingDate,
    status: piece.status,
    createdAt: piece.createdAt,
    product: piece.product,
    digitalIdentity: piece.digitalIdentity
      ? {
          publicToken: piece.digitalIdentity.publicToken,
          status: piece.digitalIdentity.status
        }
      : null,
    currentOwner: piece.ownershipRecords[0]?.owner ?? null,
    activeQr: activeQr && activeQr.status === 'ACTIVE' ? { token: activeQr.token } : null
  }
}