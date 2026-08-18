import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import { Public } from '../common/decorators/public.decorator'
import type { EnvConfig } from '../config/env.validation'
import { CookieService, REFRESH_COOKIE } from './cookies.service'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { RecoverChallengeDto, VerifyChallengeDto } from '../mfa/dto/mfa.dto'
import { CsrfService } from '../security/csrf.service'
import { SkipCsrf } from '../security/csrf.guard'

const clientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.ip ?? 'unknown'
}

const clientUserAgent = (req: Request): string | undefined =>
  typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined

@Public()
@Controller('auth')
export class AuthController {
  private readonly accessTtlSeconds: number
  private readonly sessionTtlDays: number

  constructor(
    private readonly authService: AuthService,
    private readonly cookies: CookieService,
    private readonly csrf: CsrfService,
    config: ConfigService<EnvConfig, true>
  ) {
    this.accessTtlSeconds = config.get('jwtAccessTtlSeconds', { infer: true })
    this.sessionTtlDays = config.get('sessionTtlDays', { infer: true })
  }

  @Get('csrf')
  async getCsrf(@Res({ passthrough: true }) res: Response) {
    const token = this.csrf.generateToken()
    this.cookies.setCsrfToken(res, token)
    return { csrfToken: token }
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password, clientIp(req), clientUserAgent(req))
    if (!result.mfaRequired) {
      this.attachAuthCookies(res, result.accessToken, result.refreshToken)
    }
    return {
      user: result.user,
      ...(result.mfaRequired
        ? { mfaRequired: true, challengeToken: result.challengeToken }
        : {})
    }
  }

  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (typeof refreshToken !== 'string') {
      return { refreshed: false }
    }
    const result = await this.authService.refresh(refreshToken, clientIp(req), clientUserAgent(req))
    this.attachAuthCookies(res, result.accessToken, result.refreshToken)
    return { refreshed: true }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: VerifyChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.verifyMfaChallenge(
      dto.challengeToken,
      dto.code,
      clientIp(req),
      clientUserAgent(req)
    )
    this.attachAuthCookies(res, result.accessToken, result.refreshToken)
    return { user: result.user }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/recover')
  @HttpCode(HttpStatus.OK)
  async recoverMfa(
    @Body() dto: RecoverChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.recoverMfaChallenge(
      dto.challengeToken,
      dto.recoveryCode,
      clientIp(req),
      clientUserAgent(req)
    )
    this.attachAuthCookies(res, result.accessToken, result.refreshToken)
    return { user: result.user }
  }

  @SkipCsrf()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    await this.authService.logout(refreshToken)
    this.cookies.clearAuthCookies(res)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('verify-email/:token')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Param('token') token: string) {
    return this.authService.verifyEmail(token)
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ForgotPasswordDto) {
    return this.authService.resendVerification(dto.email)
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email)
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword)
  }

  private attachAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    this.cookies.setAccessToken(res, accessToken, this.accessTtlSeconds)
    this.cookies.setRefreshToken(res, refreshToken, this.sessionTtlDays)
    this.cookies.setCsrfToken(res, this.csrf.generateToken())
  }
}