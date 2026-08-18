import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { Request, Response } from 'express'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { AuditService, AuditAction } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { CookieService, REFRESH_COOKIE } from '../auth/cookies.service'
import { UsersService } from './users.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly cookies: CookieService,
    private readonly audit: AuditService
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id)
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto)
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.usersService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword
    )
    // Un cambio de contraseña revoca TODAS las sesiones, incluida la actual
    this.cookies.clearAuthCookies(res)
    return result
  }

  @Get('me/sessions')
  async listSessions(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const currentSessionId = await this.resolveCurrentSessionId(req)
    return this.usersService.listSessions(user.id, currentSessionId)
  }

  @Get()
  @RequirePermissions('sales:create')
  listActiveUsers(@Query('search') search?: string) {
    return this.usersService.listActiveUsers(search)
  }

  @Delete('me/sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const currentSessionId = await this.resolveCurrentSessionId(req)
    const result = await this.usersService.revokeSession(user.id, sessionId, currentSessionId)
    this.audit.record(user.id, {
      action: AuditAction.SESSION_REVOKED,
      entityType: 'user',
      entityId: user.id,
      metadata: { sessionId }
    })
    if (result.isCurrent) {
      this.cookies.clearAuthCookies(res)
    }
    return result
  }

  private async resolveCurrentSessionId(req: Request): Promise<string | undefined> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (typeof refreshToken !== 'string') return undefined
    const session = await this.prisma.sessions.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      select: { id: true }
    })
    return session?.id
  }
}