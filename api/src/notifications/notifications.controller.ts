import { Controller, Get, HttpCode, Param, Patch, Query } from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications:read_own')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.list(this.notificationsService.parseListQuery(query), user.id)
  }

  @Patch(':id/read')
  @HttpCode(200)
  @RequirePermissions('notifications:update_own')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(id, user.id)
  }

  @Patch('read-all')
  @HttpCode(200)
  @RequirePermissions('notifications:update_own')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id)
  }
}