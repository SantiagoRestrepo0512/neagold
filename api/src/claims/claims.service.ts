import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { EventsService } from '../events/events.service'
import { sha256 } from '../common/utils/tokens'
import type { EnvConfig } from '../config/env.validation'

@Injectable()
export class ClaimsService {
  private readonly publicBaseUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    config: ConfigService<EnvConfig, true>
  ) {
    this.publicBaseUrl = config.get('publicBaseUrl', { infer: true })
  }

  /**
   * Canje post-venta de un solo uso.
   * - El código existe, está PENDING y no ha expirado.
   * - Solo puede canjearlo el comprador registrado en la venta.
   * - La pieza debe tener identidad digital ACTIVE.
   * - El flip de estado se hace con update condicional (PENDING -> USED)
   *   para garantizar el uso único bajo concurrencia.
   */
  async redeem(code: string, actor: { id: string }) {
    const record = await this.prisma.piece_claim_codes.findUnique({
      where: { codeHash: sha256(code) },
      include: {
        sale: {
          include: { piece: { include: { digitalIdentity: true } } }
        }
      }
    })
    if (!record || !record.sale) {
      throw new NotFoundException('Código de reclamación inválido')
    }
    if (record.status === 'USED') throw new ConflictException('El código ya fue canjeado')
    if (record.status === 'REVOKED') throw new ConflictException('El código fue revocado')
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('El código de reclamación ha expirado')
    }
    if (record.sale.buyerId !== actor.id) {
      throw new ForbiddenException('Este código no corresponde a tu cuenta')
    }
    if (!record.sale.piece.digitalIdentity || record.sale.piece.digitalIdentity.status !== 'ACTIVE') {
      throw new ConflictException('La pieza no tiene identidad digital activa para vincularla')
    }
    if (record.sale.piece.status !== 'SOLD') {
      throw new ConflictException('La pieza aún no está registrada como vendida')
    }
    // Si existe una transferencia PENDING (p. ej. pedida antes de la venta),
    // aceptarla después robaría la propiedad del comprador real.
    const pendingTransfer = await this.prisma.ownership_transfers.findFirst({
      where: { pieceId: record.pieceId, status: 'PENDING' },
      select: { id: true }
    })
    if (pendingTransfer) {
      throw new ConflictException(
        'La pieza tiene una transferencia pendiente; el vendedor debe cancelarla antes del canje'
      )
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.piece_claim_codes.updateMany({
        where: { id: record.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'USED', usedBy: actor.id, usedAt: new Date() }
      })
      if (claimed.count !== 1) {
        throw new ConflictException('El código ya fue canjeado')
      }

      const ownership = await tx.ownership_records.create({
        data: {
          pieceId: record.pieceId,
          ownerId: actor.id,
          startDate: new Date(),
          acquisitionType: 'CLAIM',
          transferId: null,
          createdBy: actor.id
        }
      })

      return { ownershipId: ownership.id }
    })

    this.audit.record(actor.id, {
      action: AuditAction.CLAIM_REDEEMED,
      entityType: 'piece',
      entityId: record.pieceId,
      metadata: { saleId: record.saleId, acquisitionType: 'CLAIM' }
    })

    await this.events.emit('claim.redeemed', {
      claimId: record.id,
      saleId: record.saleId,
      pieceId: record.pieceId,
      serialNumber: record.sale.piece.serialNumber,
      buyerId: actor.id
    })

    return {
      redeemed: true,
      piece: {
        id: record.sale.piece.id,
        serialNumber: record.sale.piece.serialNumber,
        publicId: record.sale.piece.publicId,
        internalId: record.sale.piece.internalId
      },
      verifyUrl: new URL(`/verify/${record.sale.piece.digitalIdentity.publicToken}`, this.publicBaseUrl).toString()
    }
  }

  async list(query: Record<string, unknown>, viewer: { id: string; permissions: string[] }) {
    const limit = this.parseIntParam(query['limit'], 25, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)

    const where: Prisma.piece_claim_codesWhereInput = {}
    if (!viewer.permissions.includes('claims:read')) {
      where.sale = { buyerId: viewer.id }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.piece_claim_codes.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          pieceId: true,
          status: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
          sale: { select: { invoiceNumber: true, buyerId: true } }
        }
      }),
      this.prisma.piece_claim_codes.count({ where })
    ])

    return { items, total: Number(total), limit, offset }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}