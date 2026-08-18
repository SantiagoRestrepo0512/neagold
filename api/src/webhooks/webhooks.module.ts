import { Module } from '@nestjs/common'
import { WebhooksController } from './webhooks.controller'
import { WebhooksService } from './webhooks.service'
import { DeliveryWorker } from './webhooks.worker'
import { CronController } from './cron.controller'
import { WebhookTargetValidator } from './webhook-target.validator'

@Module({
  controllers: [WebhooksController, CronController],
  providers: [WebhooksService, DeliveryWorker, WebhookTargetValidator],
  exports: [WebhooksService]
})
export class WebhooksModule {}