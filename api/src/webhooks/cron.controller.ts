import { Controller, ForbiddenException, Headers, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Public } from '../common/decorators/public.decorator'
import { SkipCsrf } from '../security/csrf.guard'
import type { EnvConfig } from '../config/env.validation'
import { WebhooksService } from './webhooks.service'

/**
 * Endpoint de cron para entornos serverless (Vercel Cron).
 *
 * En serverless no hay proceso persistente, así que DeliveryWorker no corre:
 * Vercel invoca este endpoint con `CRON_SECRET` como cabecera `x-cron-secret`
 * (ver `crons` en vercel.json) y aquí se procesa la cola de reintentos.
 * Autenticado por secreto de servidor-a-servidor (no por cookie de sesión),
 * por eso marca @SkipCsrf: Vercel Cron no puede emitir tokens CSRF.
 */
@Controller('internal/cron')
@Public()
@SkipCsrf()
export class CronController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService<EnvConfig, true>
  ) {}

  @Post('flush-webhooks')
  async flush(@Headers('x-cron-secret') secret: string | undefined) {
    const expected = this.config.get('cronSecret', { infer: true })
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Cabecera x-cron-secret inválida')
    }
    const cancelled = await this.webhooks.cancelStaleDeliveries()
    const attempted = await this.webhooks.flushDueDeliveries()
    return { ok: true, cancelled, attempted }
  }
}