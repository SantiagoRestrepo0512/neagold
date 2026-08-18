import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { NotificationType, Prisma } from '@prisma/client'
import { EventsService, type NeagoldEvent } from '../events/events.service'
import { PrismaService } from '../prisma/prisma.service'

export interface NotificationListQuery {
  unread?: boolean
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/**
 * Notificaciones in-app. Se suscribe al bus de eventos y materializa filas
 * para cada usuario afectado (destinatario de transferencias, comprador,
 * reporter de incidentes, etc.).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  onModuleInit(): void {
    this.events.on('transfer.requested', (event) =>
      this.notify(recipientId(event, 'toUserId'), 'TRANSFER_REQUEST', event.payload)
    )
    this.events.on('transfer.accepted', (event) =>
      this.notify(recipientId(event, 'fromUserId'), 'TRANSFER_ACCEPTED', event.payload)
    )
    this.events.on('transfer.rejected', (event) =>
      this.notify(recipientId(event, 'fromUserId'), 'TRANSFER_REJECTED', event.payload)
    )
    this.events.on('transfer.cancelled', (event) =>
      this.notify(recipientId(event, 'toUserId'), 'SYSTEM', {
        topic: 'transfer.cancelled',
        ...event.payload
      })
    )
    this.events.on('sale.created', (event) => {
      const buyerId = event.payload['buyerId']
      if (typeof buyerId === 'string') return this.notify(buyerId, 'CLAIM_AVAILABLE', event.payload)
    })
    this.events.on('incident.reported', (event) => {
      const reportedBy = event.payload['reportedBy']
      if (typeof reportedBy === 'string') return this.notify(reportedBy, 'PIECE_REPORTED', event.payload)
    })
    this.events.on('incident.recovered', (event) =>
      this.notify(recipientId(event, 'reportedBy'), 'PIECE_RECOVERED', event.payload)
    )
    this.events.on('incident.resolved', (event) =>
      this.notify(recipientId(event, 'reportedBy'), 'SYSTEM', {
        topic: 'incident.resolved',
        ...event.payload
      })
    )
    this.events.on('certificate.issued', (event) => {
      const ownerId = event.payload['ownerId']
      if (typeof ownerId === 'string') return this.notify(ownerId, 'CERTIFICATE_ISSUED', event.payload)
    })
    this.events.on('service.completed', (event) => {
      const ownerId = event.payload['ownerId']
      if (typeof ownerId === 'string') return this.notify(ownerId, 'SERVICE_COMPLETED', event.payload)
    })
  }

  private notify(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    return this.prisma.notifications
      .create({
        data: { userId, type, payload: payload as Prisma.InputJsonValue },
        select: { id: true }
      })
      .then(() => undefined)
  }

  parseListQuery(query: Record<string, unknown>): NotificationListQuery {
    const unread = query['unread'] === 'true'
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    return { unread: query['unread'] === undefined ? undefined : unread, limit, offset }
  }

  async list(query: NotificationListQuery, viewerId: string) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)

    const where: Prisma.notificationsWhereInput = { userId: viewerId }
    if (query.unread === true) where.readAt = null

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notifications.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          type: true,
          payload: true,
          readAt: true,
          createdAt: true
        }
      }),
      this.prisma.notifications.count({ where }),
      this.prisma.notifications.count({ where: { userId: viewerId, readAt: null } })
    ])

    return { items, total: Number(total), unreadCount: Number(unreadCount), limit, offset }
  }

  async markRead(id: string, viewerId: string) {
    const updated = await this.prisma.notifications.updateMany({
      where: { id, userId: viewerId },
      data: { readAt: new Date() }
    })
    if (updated.count !== 1) throw new NotFoundException('Notificación no encontrada')
    const notification = await this.prisma.notifications.findUnique({
      where: { id },
      select: { id: true, readAt: true }
    })
    return notification
  }

  async markAllRead(viewerId: string) {
    const updated = await this.prisma.notifications.updateMany({
      where: { userId: viewerId, readAt: null },
      data: { readAt: new Date() }
    })
    return { updated: updated.count }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new Error('Parámetros de paginación inválidos')
    return value
  }
}

function recipientId(event: NeagoldEvent, key: string): string {
  const value = event.payload[key]
  if (typeof value !== 'string') throw new Error(`${key} ausente en evento ${event.event}`)
  return value
}