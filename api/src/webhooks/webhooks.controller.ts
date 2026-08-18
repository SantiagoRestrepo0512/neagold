import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common'
import { AuditAction, AuditService } from '../audit/audit.service'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateWebhookDto } from './dto/create-webhook.dto'
import { UpdateWebhookDto } from './dto/update-webhook.dto'
import { WebhooksService } from './webhooks.service'

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  async create(@Body() dto: CreateWebhookDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.webhooksService.create(dto, user.id)
    this.audit.record(user.id, {
      action: AuditAction.WEBHOOK_CREATED,
      entityType: 'webhook',
      entityId: result.webhook.id,
      metadata: { url: result.webhook.url }
    })
    return result
  }

  @Get()
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.list(this.webhooksService.parseListQuery(query), user)
  }

  @Get(':id')
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.findById(id, user)
  }

  @Get(':id/deliveries')
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  deliveries(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.webhooksService.deliveries(id, this.webhooksService.parseListQuery(query), user)
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const result = await this.webhooksService.update(id, dto, user)
    this.audit.record(user.id, {
      action: AuditAction.WEBHOOK_UPDATED,
      entityType: 'webhook',
      entityId: result.webhook.id,
      metadata: { url: result.webhook.url }
    })
    return result
  }

  @Post(':id/secret')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  async rotateSecret(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.webhooksService.rotateSecret(id, user)
    this.audit.record(user.id, {
      action: AuditAction.WEBHOOK_SECRET_ROTATED,
      entityType: 'webhook',
      entityId: id
    })
    return result
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('webhooks:manage_own', 'webhooks:manage')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.webhooksService.remove(id, user)
    this.audit.record(user.id, {
      action: AuditAction.WEBHOOK_DELETED,
      entityType: 'webhook',
      entityId: id
    })
    return { deleted: true }
  }
}