import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvConfig } from '../config/env.validation'
import { WebhooksService } from './webhooks.service'

/**
 * Worker de reintentos: sondea la cola de entregas pendientes/vencidas.
 * El intervalo se configura con WEBHOOK_DELIVERY_POLL_MS (0 lo desactiva).
 */
@Injectable()
export class DeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService<EnvConfig, true>
  ) {}

  onModuleInit(): void {
    // En serverless (Vercel) no hay proceso persistente: el interval no corre
    // y la cola de reintentos la procesa el endpoint de cron (cron.controller.ts).
    if (process.env.VERCEL === '1') {
      this.logger.log('Delivery worker desactivado (entorno serverless; usa el endpoint de cron)')
      return
    }
    const pollMs = this.config.get('webhookDeliveryPollMs', { infer: true })
    if (pollMs <= 0) return
    this.timer = setInterval(() => {
      void this.tick()
    }, pollMs)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    try {
      await this.webhooks.cancelStaleDeliveries()
      const attempted = await this.webhooks.flushDueDeliveries()
      if (attempted > 0) this.logger.debug(`Reintentos procesados: ${attempted}`)
    } catch (error: unknown) {
      this.logger.error(`Delivery worker falló: ${String(error)}`)
    }
  }
}