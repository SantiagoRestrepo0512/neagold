import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateTransferDto } from './dto/create-transfer.dto'
import { TransfersService } from './transfers.service'

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('transfers:request', 'transfers:manage')
  request(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.request(dto, user)
  }

  @Get()
  @RequirePermissions('transfers:manage')
  list(@Query() query: Record<string, unknown>) {
    return this.transfersService.listAll(this.transfersService.parseListQuery(query))
  }

  @Get('incoming')
  @RequirePermissions('transfers:accept', 'transfers:reject')
  incoming(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.listIncoming(this.transfersService.parseListQuery(query), user.id)
  }

  @Get('outgoing')
  @RequirePermissions('transfers:request')
  outgoing(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.listOutgoing(this.transfersService.parseListQuery(query), user.id)
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('transfers:accept', 'transfers:manage')
  accept(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.accept(id, user)
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('transfers:reject', 'transfers:manage')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.reject(id, user)
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('transfers:request', 'transfers:manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.cancel(id, user)
  }
}