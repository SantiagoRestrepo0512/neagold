import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { IncidentsService } from '../incidents/incidents.service'
import { EventsService } from '../events/events.service'
import { CreateTransferDto } from './dto/create-transfer.dto'

const TRANSFER_TTL_DAYS = 7
const TTL_MS = TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000

const NON_TRANSFERABLE_STATUSES = new Set(['RETIRED', 'LOST', 'REPORTED_STOLEN'])

const TRANSFER_INCLUDE = {
  piece: { select: { id: true, internalId: true, serialNumber: true, status: true } },
  fromUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  toUser: { select: { id: true, email: true, firstName: true, lastName: true } }
} satisfies Prisma.ownership_transfersInclude

type TransferDetail = Prisma.ownership_transfersGetPayload<{ include: typeof TRANSFER_INCLUDE }>

export interface TransferListQuery {
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly incidents: IncidentsService,
    private readonly events: EventsService
  ) {}

  /**
   * Solicitud de transferencia: la inicia el propietario activo actual de la
   * pieza (o staff con transfers:manage en su nombre). Una pieza solo admite
   * una transferencia PENDING a la vez (partial unique index en BD).
   */
  async request(dto: CreateTransferDto, actor: { id: string; permissions: string[] }) {
    const piece = await this.prisma.jewelry_pieces.findUnique({ where: { id: dto.pieceId } })
    if (!piece) throw new NotFoundException('Pieza no encontrada')
    if (await this.incidents.hasOpenIncident(piece.id)) {
      throw new BadRequestException('La pieza tiene un incidente abierto y no puede transferirse')
    }
    if (NON_TRANSFERABLE_STATUSES.has(piece.status)) {
      throw new BadRequestException(`No se puede transferir una pieza en estado ${piece.status}`)
    }

    const target = await this.prisma.users.findUnique({ where: { id: dto.toUserId } })
    if (!target || target.status !== 'ACTIVE') {
      throw new NotFoundException('Destinatario no encontrado')
    }
    if (target.id === actor.id) {
      throw new BadRequestException('No puedes transferirte una pieza a ti mismo')
    }

    const activeOwner = await this.prisma.ownership_records.findFirst({
      where: { pieceId: piece.id, endDate: null }
    })
    if (!activeOwner) {
      throw new BadRequestException('La pieza no tiene propietario activo')
    }
    const isStaff = actor.permissions.includes('transfers:manage')
    if (activeOwner.ownerId !== actor.id && !isStaff) {
      throw new ForbiddenException('Solo el propietario actual puede transferir la pieza')
    }

    const transfer = await this.prisma.ownership_transfers.create({
      data: {
        pieceId: piece.id,
        fromUserId: activeOwner.ownerId,
        toUserId: dto.toUserId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + TTL_MS)
      }
    })

    this.audit.record(actor.id, {
      action: AuditAction.TRANSFER_REQUESTED,
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: { pieceId: piece.id, toUserId: dto.toUserId }
    })

    await this.events.emit('transfer.requested', {
      transferId: transfer.id,
      pieceId: piece.id,
      serialNumber: piece.serialNumber,
      fromUserId: activeOwner.ownerId,
      toUserId: dto.toUserId,
      expiresAt: transfer.expiresAt.toISOString()
    })

    return this.detail(transfer.id)
  }

  /** Aceptación: transfiere la propiedad cerrando el ownership actual
   *  (end_date) antes de crear el nuevo, respetando el trigger
   *  piece_already_has_active_owner. */
  async accept(id: string, actor: { id: string; permissions: string[] }) {
    const transfer = await this.loadPending(id)
    if (transfer.toUserId !== actor.id && !actor.permissions.includes('transfers:manage')) {
      throw new ForbiddenException('Solo el destinatario puede aceptar la transferencia')
    }

    const acceptedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ownership_transfers.updateMany({
        where: { id: transfer.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'ACCEPTED', acceptedAt }
      })
      if (updated.count !== 1) {
        throw new BadRequestException('La transferencia ya ha sido resuelta o ha expirado')
      }
      // Defensa en profundidad: el propietario activo debe seguir siendo quien
      // solicitó la transferencia; si cambió, la aceptación queda invalidada.
      const activeOwner = await tx.ownership_records.findFirst({
        where: { pieceId: transfer.pieceId, endDate: null },
        select: { ownerId: true }
      })
      if (!activeOwner || activeOwner.ownerId !== transfer.fromUserId) {
        throw new BadRequestException('El propietario actual ya no es quien solicitó la transferencia')
      }
      await tx.ownership_records.updateMany({
        where: { pieceId: transfer.pieceId, endDate: null },
        data: { endDate: acceptedAt }
      })
      await tx.ownership_records.create({
        data: {
          pieceId: transfer.pieceId,
          ownerId: transfer.toUserId,
          startDate: acceptedAt,
          acquisitionType: 'TRANSFER',
          transferId: transfer.id,
          createdBy: actor.id
        }
      })
    })

    this.audit.record(actor.id, {
      action: AuditAction.TRANSFER_ACCEPTED,
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: { pieceId: transfer.pieceId, toUserId: transfer.toUserId }
    })

    await this.events.emit('transfer.accepted', {
      transferId: transfer.id,
      pieceId: transfer.pieceId,
      serialNumber: transfer.piece.serialNumber,
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId,
      fromEmail: transfer.fromUser.email
    })

    return this.detail(transfer.id)
  }

  async reject(id: string, actor: { id: string; permissions: string[] }) {
    const transfer = await this.loadPending(id)
    if (transfer.toUserId !== actor.id && !actor.permissions.includes('transfers:manage')) {
      throw new ForbiddenException('Solo el destinatario puede rechazar la transferencia')
    }

    const rejectedAt = new Date()
    const updated = await this.prisma.ownership_transfers.updateMany({
      where: { id: transfer.id, status: 'PENDING', expiresAt: { gt: rejectedAt } },
      data: { status: 'REJECTED', rejectedAt }
    })
    if (updated.count !== 1) {
      throw new BadRequestException('La transferencia ya ha sido resuelta o ha expirado')
    }

    this.audit.record(actor.id, {
      action: AuditAction.TRANSFER_REJECTED,
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: { pieceId: transfer.pieceId }
    })

    await this.events.emit('transfer.rejected', {
      transferId: transfer.id,
      pieceId: transfer.pieceId,
      serialNumber: transfer.piece.serialNumber,
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId
    })

    return this.detail(transfer.id)
  }

  /** Cancelación: solo el solicitante (o staff con transfers:manage). */
  async cancel(id: string, actor: { id: string; permissions: string[] }) {
    const transfer = await this.loadPending(id)
    const isStaff = actor.permissions.includes('transfers:manage')
    if (transfer.fromUserId !== actor.id && !isStaff) {
      throw new ForbiddenException('Solo el solicitante puede cancelar la transferencia')
    }

    const cancelledAt = new Date()
    const updated = await this.prisma.ownership_transfers.updateMany({
      where: { id: transfer.id, status: 'PENDING', expiresAt: { gt: cancelledAt } },
      data: { status: 'CANCELLED', cancelledAt }
    })
    if (updated.count !== 1) {
      throw new BadRequestException('La transferencia ya ha sido resuelta o ha expirado')
    }

    this.audit.record(actor.id, {
      action: AuditAction.TRANSFER_CANCELLED,
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: { pieceId: transfer.pieceId }
    })

    await this.events.emit('transfer.cancelled', {
      transferId: transfer.id,
      pieceId: transfer.pieceId,
      serialNumber: transfer.piece.serialNumber,
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId
    })

    return this.detail(transfer.id)
  }

  async listAll(query: TransferListQuery) {
    return this.list(query, {})
  }

  async listIncoming(query: TransferListQuery, viewerId: string) {
    return this.list(query, { toUserId: viewerId })
  }

  async listOutgoing(query: TransferListQuery, viewerId: string) {
    return this.list(query, { fromUserId: viewerId })
  }

  parseListQuery(query: Record<string, unknown>): TransferListQuery {
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    return { limit, offset }
  }

  private async loadPending(id: string): Promise<TransferDetail> {
    const transfer = await this.prisma.ownership_transfers.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE
    })
    if (!transfer) throw new NotFoundException('Transferencia no encontrada')
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException(`La transferencia está en estado ${transfer.status}`)
    }
    if (transfer.expiresAt < new Date()) {
      await this.prisma.ownership_transfers.updateMany({
        where: { id: transfer.id, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      })
      throw new BadRequestException('La transferencia ha expirado')
    }
    return transfer
  }

  private async detail(id: string) {
    const transfer = await this.prisma.ownership_transfers.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE
    })
    if (!transfer) throw new NotFoundException('Transferencia no encontrada')
    return serializeTransfer(transfer)
  }

  private async list(query: TransferListQuery, where: Prisma.ownership_transfersWhereInput) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ownership_transfers.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: TRANSFER_INCLUDE
      }),
      this.prisma.ownership_transfers.count({ where })
    ])

    return { items: items.map(serializeTransfer), total: Number(total), limit, offset }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}

function serializeTransfer(transfer: TransferDetail) {
  return {
    id: transfer.id,
    piece: transfer.piece,
    fromUser: transfer.fromUser,
    toUser: transfer.toUser,
    status: transfer.status,
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
    acceptedAt: transfer.acceptedAt,
    rejectedAt: transfer.rejectedAt,
    cancelledAt: transfer.cancelledAt
  }
}