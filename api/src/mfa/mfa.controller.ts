import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator'
import { MfaService } from './mfa.service'
import { DisableMfaDto, VerifySetupDto } from './dto/mfa.dto'

/** Gestión de MFA del usuario autenticado (setup, disable, status).
 *  La verificación del desafío de login vive en AuthController (emite cookies). */
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.status(user.id)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  async setup(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.setup(user.id, user.email)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-setup')
  @HttpCode(HttpStatus.OK)
  async verifySetup(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifySetupDto) {
    return this.mfaService.verifySetup(user.id, dto.secret, dto.code)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@CurrentUser() user: AuthenticatedUser, @Body() dto: DisableMfaDto) {
    return this.mfaService.disable(user.id, dto.code)
  }
}