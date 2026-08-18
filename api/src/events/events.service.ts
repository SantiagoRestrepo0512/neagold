import { Injectable, Logger } from '@nestjs/common'

/** Eventos de dominio que alimentan notificaciones y webhooks. */
export const WEBHOOK_EVENTS = [
  'transfer.requested',
  'transfer.accepted',
  'transfer.rejected',
  'transfer.cancelled',
  'sale.created',
  'claim.redeemed',
  'incident.reported',
  'incident.recovered',
  'incident.resolved',
  'certificate.issued',
  'service.completed'
] as const

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number]

export interface NeagoldEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  event: WebhookEventName
  occurredAt: string
  payload: P
}

type Handler = (event: NeagoldEvent) => void | Promise<void>

/**
 * Bus de eventos en proceso (síncrono). Cada emisor hace `await emit(...)`
 * para que los handlers (notificaciones, webhooks) persistan su side effect
 * antes de responder; un handler fallido jamás rompe el flujo principal.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name)
  private readonly handlers = new Map<WebhookEventName, Handler[]>()

  on(event: WebhookEventName, handler: Handler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  async emit<P extends Record<string, unknown>>(event: WebhookEventName, payload: P): Promise<void> {
    const envelope: NeagoldEvent<P> = {
      event,
      occurredAt: new Date().toISOString(),
      payload
    }
    const list = this.handlers.get(event)
    if (!list) return
    await Promise.all(
      list.map((handler) =>
        Promise.resolve()
          .then(() => handler(envelope))
          .catch((error: unknown) => {
            this.logger.error(`Handler fallido para ${event}: ${String(error)}`)
          })
      )
    )
  }

  hasListeners(event: WebhookEventName): boolean {
    return (this.handlers.get(event)?.length ?? 0) > 0
  }
}