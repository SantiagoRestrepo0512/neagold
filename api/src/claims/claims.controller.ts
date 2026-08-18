import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { ClaimsService } from './claims.service'
import { RedeemClaimDto } from './dto/redeem-claim.dto'

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post('redeem')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('claims:redeem')
  redeem(@Body() dto: RedeemClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.claimsService.redeem(dto.code, user)
  }

  @Get()
  @RequirePermissions('claims:read')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.claimsService.list(query, user)
  }
}