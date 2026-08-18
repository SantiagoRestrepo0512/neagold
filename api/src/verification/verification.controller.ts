import { Controller, Get, Param } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../common/decorators/public.decorator'
import { VerificationService } from './verification.service'

@Controller('verify')
@Public()
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':publicToken')
  verify(@Param('publicToken') publicToken: string) {
    return this.verificationService.verify(publicToken)
  }
}