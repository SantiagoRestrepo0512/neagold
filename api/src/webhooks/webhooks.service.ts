import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes, createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { EnvConfig } from '../config/env.validation'
import { EventsService, WEBHOOK_EVENTS, type NeagoldEvent } from '../events/events.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateWebhookDto } from './dto/create-webhook.dto'
import { UpdateWebhookDto } from './dto/update-webhook.dto'
import { WebhookTargetValidator } from './webhook-target.validator'

const MAX_FAILURES_BEFORE_DISABLE = 5
const MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 60_000

const WEBHOOK_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  failureCount: true,
  lastDeliveryAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.webhooksSelect

const DELIVERY_SELECT = {
  id: true,
  eventType: true,
  payload: true,
  status: true,
  statusCode: true,
  error: true,
  attempts: true,
  deliveredAt: true,
  nextAttemptAt: true,
  createdAt: true
} satisfies Prisma.webhook_deliveriesSelect

export interface WebhookListQuery {
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/**
 * Webhooks salientes: endpoints configurados por el usuario que reciben
 * firmados (HMAC-SHA256) los eventos de dominio. La entrega es inmediata
 * (fire-and-forget) con reintentos de backoff exponencial gestionados por
 * DeliveryWorker; tras MAX_FAILURES_BEFORE_DISABLE el endpoint se desactiva.
 *
 * NOTA: servicio singleton (no inyecta AuditService, que es request-scoped)
 * para que onModuleInit registre las suscripciones al bus una sola vez.
 * La auditoría de las operaciones CRUD se registra en el controller.
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly targetValidator: WebhookTargetValidator
  ) {}

  onModuleInit(): void {
    for (const event of WEBHOOK_EVENTS) {
      this.events.on(event, (envelope) => this.enqueueDelivery(envelope))
    }
  }

  async create(dto: CreateWebhookDto, actorId: string) {
    await this.targetValidator.validate(dto.url)
    const secret = randomBytes(32).toString('base64url')
    const webhook = await this.prisma.webhooks.create({
      data: {
        userId: actorId,
        url: dto.url,
        secret,
        events: dto.events
      },
      select: WEBHOOK_SELECT
    })

    return { webhook, secret }
  }

  async list(query: WebhookListQuery, viewer: { id: string; permissions: string[] }) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)
    const where: Prisma.webhooksWhereInput = this.isStaff(viewer) ? {} : { userId: viewer.id }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhooks.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: WEBHOOK_SELECT
      }),
      this.prisma.webhooks.count({ where })
    ])
    return { items, total: Number(total), limit, offset }
  }

  async findById(id: string, viewer: { id: string; permissions: string[] }) {
    const webhook = await this.load(id, viewer)
    return { webhook }
  }

  async update(id: string, dto: UpdateWebhookDto, actor: { id: string; permissions: string[] }) {
    const webhook = await this.load(id, actor)
    const nextUrl = dto.url ?? webhook.url
    await this.targetValidator.validate(nextUrl)
    const updated = await this.prisma.webhooks.update({
      where: { id: webhook.id },
      data: {
        url: dto.url,
        events: dto.events,
        isActive: dto.isActive
      },
      select: WEBHOOK_SELECT
    })
    return { webhook: updated }
  }

  async rotateSecret(id: string, actor: { id: string; permissions: string[] }) {
    const webhook = await this.load(id, actor)
    const secret = randomBytes(32).toString('base64url')
    await this.prisma.webhooks.update({
      where: { id: webhook.id },
      data: { secret }
    })
    return { secret }
  }

  async remove(id: string, actor: { id: string; permissions: string[] }) {
    const webhook = await this.load(id, actor)
    await this.prisma.webhooks.delete({ where: { id: webhook.id } })
    return { deleted: true }
  }

  async deliveries(webhookId: string, query: WebhookListQuery, viewer: { id: string; permissions: string[] }) {
    const webhook = await this.load(webhookId, viewer)
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)
    await this.flushDueDeliveries()
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhook_deliveries.findMany({
        where: { webhookId: webhook.id },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: DELIVERY_SELECT
      }),
      this.prisma.webhook_deliveries.count({ where: { webhookId: webhook.id } })
    ])
    return { items, total: Number(total), limit, offset }
  }

  parseListQuery(query: Record<string, unknown>): WebhookListQuery {
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    return { limit, offset }
  }

  /** Handler del bus: crea una entrega PENDING e intenta enviarla ya. */
  private async enqueueDelivery(envelope: NeagoldEvent): Promise<void> {
    const webhooks = await this.prisma.webhooks.findMany({
      where: { isActive: true, events: { has: envelope.event } },
      select: { id: true }
    })
    for (const webhook of webhooks) {
      const delivery = await this.prisma.webhook_deliveries.create({
        data: {
          webhookId: webhook.id,
          eventType: envelope.event,
          payload: envelope.payload as Prisma.InputJsonValue
        }
      })
      await this.attempt(delivery.id)
    }
  }

  /** Reintenta entregas PENDING o FAILED con backoff vencido. */
  async flushDueDeliveries(): Promise<number> {
    const now = new Date()
    const due = await this.prisma.webhook_deliveries.findMany({
      where: {
        OR: [{ status: 'PENDING' }, { status: 'FAILED', nextAttemptAt: { lte: now } }],
        webhook: { isActive: true }
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true }
    })
    for (const delivery of due) {
      await this.attempt(delivery.id)
    }
    return due.length
  }

  /** Marca CANCELLED las entregas pendientes de webhooks desactivados. */
  async cancelStaleDeliveries(): Promise<number> {
    const cancelled = await this.prisma.webhook_deliveries.updateMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        webhook: { isActive: false }
      },
      data: { status: 'CANCELLED' }
    })
    return cancelled.count
  }

  private async attempt(deliveryId: string): Promise<void> {
    const claimed = await this.prisma.webhook_deliveries.updateMany({
      where: { id: deliveryId, status: 'PENDING' },
      data: { status: 'DELIVERING' }
    })
    if (claimed.count !== 1) return

    const delivery = await this.prisma.webhook_deliveries.findUnique({
      where: { id: deliveryId },
      include: { webhook: { select: { id: true, url: true, secret: true, isActive: true, failureCount: true } } }
    })
    if (!delivery || !delivery.webhook.isActive) {
      if (delivery) {
        await this.prisma.webhook_deliveries.update({
          where: { id: deliveryId },
          data: { status: 'CANCELLED' }
        })
      }
      return
    }

    // Anti-SSRF en el momento de la entrega (re-resolución DNS).
    try {
      await this.targetValidator.validate(delivery.webhook.url)
    } catch {
      await this.markFailed(delivery.id, delivery.webhook.id, null, 'destino no permitido (SSRF)')
      return
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.eventType,
      occurredAt: delivery.createdAt,
      payload: delivery.payload
    })
    const signature = createHmac('sha256', delivery.webhook.secret).update(body).digest('hex')
    const timeoutMs = this.config.get('webhookDeliveryTimeoutMs', { infer: true })

    try {
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'neagold-webhooks/1.0',
          'x-neagold-event': delivery.eventType,
          'x-neagold-delivery': delivery.id,
          'x-neagold-signature': `sha256=${signature}`
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })

      if (response.ok) {
        await this.prisma.$transaction([
          this.prisma.webhook_deliveries.update({
            where: { id: delivery.id },
            data: { status: 'SUCCESS', statusCode: response.status, attempts: { increment: 1 }, deliveredAt: new Date(), nextAttemptAt: null }
          }),
          this.prisma.webhooks.update({
            where: { id: delivery.webhook.id },
            data: { failureCount: 0, lastDeliveryAt: new Date() }
          })
        ])
      } else {
        await this.markFailed(delivery.id, delivery.webhook.id, response.status)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error)
      await this.markFailed(delivery.id, delivery.webhook.id, null, message)
    }
  }

  private async markFailed(deliveryId: string, webhookId: string, statusCode: number | null, error?: string) {
    const delivery = await this.prisma.webhook_deliveries.findUnique({
      where: { id: deliveryId },
      select: { attempts: true }
    })
    const attempts = (delivery?.attempts ?? 0) + 1
    const tooMany = attempts >= MAX_ATTEMPTS
    const up = await this.prisma.webhooks.update({
      where: { id: webhookId },
      data: { failureCount: { increment: 1 } },
      select: { failureCount: true }
    })
    const disable = up.failureCount >= MAX_FAILURES_BEFORE_DISABLE || tooMany

    await this.prisma.$transaction([
      this.prisma.webhook_deliveries.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          statusCode,
          error: error ?? `HTTP ${statusCode ?? 'sin respuesta'}`,
          attempts,
          nextAttemptAt: disable ? null : new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, attempts - 1))
        }
      }),
      this.prisma.webhooks.update({
        where: { id: webhookId },
        data: { isActive: disable ? false : true }
      })
    ])
  }

  private isStaff(viewer: { permissions: string[] }): boolean {
    return viewer.permissions.includes('webhooks:manage')
  }

  private async load(id: string, viewer: { id: string; permissions: string[] }) {
    const webhook = await this.prisma.webhooks.findUnique({
      where: { id },
      select: { ...WEBHOOK_SELECT, userId: true }
    })
    if (!webhook) throw new NotFoundException('Webhook no encontrado')
    if (webhook.userId !== viewer.id && !this.isStaff(viewer)) {
      throw new ForbiddenException('No tienes permiso para este webhook')
    }
    return webhook
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}