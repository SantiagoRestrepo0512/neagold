import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { EventsService } from '../events/events.service'
import { CreateServiceDto } from './dto/create-service.dto'
import { CompleteServiceDto } from './dto/complete-service.dto'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

const PIECE_SELECT = { id: true, publicId: true, serialNumber: true, status: true }

const SERVICE_INCLUDE = {
  piece: { select: { ...PIECE_SELECT, material: true, purity: true } },
  requester: { select: { id: true, email: true, firstName: true, lastName: true } },
  performer: { select: { id: true, email: true, firstName: true, lastName: true } }
} satisfies Prisma.service_recordsInclude

type ServiceRow = Prisma.service_recordsGetPayload<{ include: typeof SERVICE_INCLUDE }>

interface Viewer {
  id: string
  permissions: string[]
}

/**
 * Órdenes de servicio (limpieza, reparación, ajuste, inspección...).
 * Ciclo: REQUESTED → IN_PROGRESS → COMPLETED (o CANCELLED desde REQUESTED).
 * Al completar, una pieza en IN_SERVICE vuelve a AVAILABLE y se notifica al
 * propietario actual.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  async create(dto: CreateServiceDto, viewer: Viewer) {
    const hasStaffPerm = this.hasAny(viewer, ['services:create', 'services:complete'])
    if (!hasStaffPerm && !viewer.permissions.includes('services:request')) {
      throw new ForbiddenException('No tienes permiso para solicitar servicios')
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const piece = await tx.jewelry_pieces.findUnique({
        where: { id: dto.pieceId },
        select: { id: true, serialNumber: true, status: true }
      })
      if (!piece) throw new NotFoundException('Pieza no encontrada')
      if (piece.status === 'RETIRED') {
        throw new BadRequestException('No se pueden solicitar servicios para piezas retiradas')
      }

      const service = await tx.service_records.create({
        data: {
          pieceId: piece.id,
          type: dto.type,
          status: 'REQUESTED',
          requestedBy: viewer.id,
          notes: dto.notes ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null
        }
      })

      return { service, serialNumber: piece.serialNumber }
    })

    return this.load(result.service.id).then((service) => ({
      service: serializeService(service)
    }))
  }

  async start(id: string, viewer: Viewer) {
    if (!this.hasAny(viewer, ['services:create', 'services:complete'])) {
      throw new ForbiddenException('No tienes permiso para iniciar servicios')
    }

    const record = await this.requireService(id)
    if (record.status !== 'REQUESTED') {
      throw new BadRequestException('Solo se pueden iniciar servicios en estado solicitado')
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.service_records.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'IN_PROGRESS', performedBy: viewer.id }
      })
      if (updated.count !== 1) {
        throw new BadRequestException('El servicio ya fue iniciado o cancelado')
      }
      // La pieza pasa a IN_SERVICE mientras hay un trabajo en curso.
      await tx.jewelry_pieces.updateMany({
        where: { id: record.pieceId, status: { in: ['IN_STOCK', 'AVAILABLE'] } },
        data: { status: 'IN_SERVICE' }
      })
    })

    const service = await this.load(id)
    return { service: serializeService(service) }
  }

  async complete(id: string, dto: CompleteServiceDto, viewer: Viewer) {
    if (!viewer.permissions.includes('services:complete')) {
      throw new ForbiddenException('No tienes permiso para completar servicios')
    }

    const record = await this.requireService(id)
    if (record.status !== 'REQUESTED' && record.status !== 'IN_PROGRESS') {
      throw new BadRequestException('El servicio no está en un estado completable')
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.service_records.updateMany({
        where: { id, status: { in: ['REQUESTED', 'IN_PROGRESS'] } },
        data: {
          status: 'COMPLETED',
          notes: dto.notes ?? record.notes,
          completedAt: new Date(),
          performedBy: record.performedBy ?? viewer.id
        }
      })
      if (updated.count !== 1) {
        throw new BadRequestException('El servicio no está en un estado completable')
      }

      const piece = await tx.jewelry_pieces.findUnique({
        where: { id: record.pieceId },
        select: {
          id: true,
          serialNumber: true,
          status: true,
          ownershipRecords: {
            where: { endDate: null },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: { ownerId: true }
          }
        }
      })
      if (!piece) throw new NotFoundException('Pieza no encontrada')

      if (piece.status === 'IN_SERVICE') {
        await tx.jewelry_pieces.update({
          where: { id: piece.id },
          data: { status: 'AVAILABLE' }
        })
      }

      return {
        serviceId: record.id,
        serialNumber: piece.serialNumber,
        ownerId: piece.ownershipRecords[0]?.ownerId ?? null
      }
    })

    await this.events.emit('service.completed', {
      serviceId: outcome.serviceId,
      pieceId: record.pieceId,
      serialNumber: outcome.serialNumber,
      ownerId: outcome.ownerId
    })

    const service = await this.load(id)
    return { service: serializeService(service) }
  }

  async cancel(id: string, viewer: Viewer) {
    const record = await this.requireService(id)
    if (record.status !== 'REQUESTED') {
      throw new BadRequestException('Solo se pueden cancelar servicios en estado solicitado')
    }
    const isRequester = record.requestedBy === viewer.id
    if (!this.hasAny(viewer, ['services:create', 'services:complete']) && !isRequester) {
      throw new ForbiddenException('No tienes permiso para cancelar este servicio')
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.service_records.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'CANCELLED' }
      })
      if (updated.count !== 1) {
        throw new BadRequestException('El servicio ya fue iniciado o cancelado')
      }
    })

    const service = await this.load(id)
    return { service: serializeService(service) }
  }

  async list(query: Record<string, unknown>, viewer: Viewer) {
    const limit = Math.min(this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = this.parseIntParam(query['offset'], 0, 0)

    const where: Prisma.service_recordsWhereInput = {}
    if (!viewer.permissions.includes('services:read')) {
      // Cliente con services:request: sus solicitudes o piezas que posee.
      where.OR = [
        { requestedBy: viewer.id },
        { piece: { ownershipRecords: { some: { ownerId: viewer.id, endDate: null } } } }
      ]
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.service_records.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: SERVICE_INCLUDE
      }),
      this.prisma.service_records.count({ where })
    ])

    return {
      items: items.map((item) => serializeService(item)),
      total: Number(total),
      limit,
      offset
    }
  }

  async findById(id: string, viewer: Viewer) {
    const service = await this.load(id)
    const canRead = viewer.permissions.includes('services:read')
    const involved = service.requestedBy === viewer.id
    if (!canRead && !involved) {
      throw new ForbiddenException('No tienes permiso para ver este servicio')
    }
    return { service: serializeService(service) }
  }

  private async load(id: string): Promise<ServiceRow> {
    const service = await this.prisma.service_records.findUnique({
      where: { id },
      include: SERVICE_INCLUDE
    })
    if (!service) throw new NotFoundException('Servicio no encontrado')
    return service
  }

  private async requireService(id: string): Promise<ServiceRow> {
    return this.load(id)
  }

  private hasAny(viewer: Viewer, permissions: string[]): boolean {
    return permissions.some((permission) => viewer.permissions.includes(permission))
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

function serializeService(service: ServiceRow) {
  return {
    id: service.id,
    pieceId: service.pieceId,
    type: service.type,
    status: service.status,
    requestedBy: service.requester,
    performedBy: service.performer,
    notes: service.notes,
    scheduledAt: service.scheduledAt,
    completedAt: service.completedAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    piece: service.piece
  }
}