import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { RegisterPieceDto } from './dto/register-piece.dto'
import { UpdatePieceStatusDto } from './dto/update-piece-status.dto'
import { PiecesService } from './pieces.service'

@Controller('pieces')
export class PiecesController {
  constructor(private readonly piecesService: PiecesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pieces:create')
  register(@Body() dto: RegisterPieceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.piecesService.register(dto, user.id)
  }

  @Get()
  @RequirePermissions('pieces:list', 'pieces:read_own')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.piecesService.list(this.piecesService.parseListQuery(query), user)
  }

  @Get(':id')
  @RequirePermissions('pieces:read', 'pieces:read_own')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.piecesService.findById(id, user)
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pieces:update_status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePieceStatusDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.piecesService.updateStatus(id, dto.status, user.id)
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pieces:retire')
  retire(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.piecesService.retire(id, user.id)
  }

  @Post(':id/qr/regenerate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('qr:regenerate')
  regenerateQr(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.piecesService.regenerateQr(id, user.id)
  }
}