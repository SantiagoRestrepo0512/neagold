import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query
} from '@nestjs/common'
import { AuditAction, AuditService } from '../audit/audit.service'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateServiceDto } from './dto/create-service.dto'
import { CompleteServiceDto } from './dto/complete-service.dto'
import { ServicesService } from './services.service'

@Controller('services')
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('services:request', 'services:create')
  async create(@Body() dto: CreateServiceDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.servicesService.create(dto, user)
    this.audit.record(user.id, {
      action: AuditAction.SERVICE_CREATED,
      entityType: 'service',
      entityId: result.service.id,
      metadata: { pieceId: dto.pieceId, type: dto.type }
    })
    return result
  }

  @Get()
  @RequirePermissions('services:read', 'services:request')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.list(query, user)
  }

  @Get(':id')
  @RequirePermissions('services:read', 'services:request')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.findById(id, user)
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('services:create', 'services:complete')
  async start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.start(id, user)
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('services:complete')
  async complete(
    @Param('id') id: string,
    @Body() dto: CompleteServiceDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const result = await this.servicesService.complete(id, dto, user)
    this.audit.record(user.id, {
      action: AuditAction.SERVICE_COMPLETED,
      entityType: 'service',
      entityId: id
    })
    return result
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('services:create', 'services:complete', 'services:request')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.servicesService.cancel(id, user)
    this.audit.record(user.id, {
      action: AuditAction.SERVICE_CANCELLED,
      entityType: 'service',
      entityId: id
    })
    return result
  }
}