import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateSaleDto } from './dto/create-sale.dto'
import { SalesService } from './sales.service'

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sales:create')
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.salesService.create(dto, user.id)
  }

  @Get()
  @RequirePermissions('sales:read')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.salesService.list(query, user)
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  detail(@Param('id') id: string) {
    return this.salesService.findById(id)
  }
}