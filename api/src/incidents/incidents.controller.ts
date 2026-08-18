import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { AddIncidentReportDto } from './dto/add-incident-report.dto'
import { CreateIncidentDto } from './dto/create-incident.dto'
import { IncidentsService } from './incidents.service'

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('incidents:create')
  report(@Body() dto: CreateIncidentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.report(dto, user)
  }

  @Get()
  @RequirePermissions('incidents:read', 'incidents:read_own')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.list(this.incidentsService.parseListQuery(query), user)
  }

  @Get(':id')
  @RequirePermissions('incidents:read', 'incidents:read_own')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.findById(id, user)
  }

  @Post(':id/reports')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('incidents:create', 'incidents:read_own')
  addReport(
    @Param('id') id: string,
    @Body() dto: AddIncidentReportDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.incidentsService.addReport(id, dto, user)
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('incidents:review')
  review(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.review(id, user)
  }

  @Post(':id/recover')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('incidents:recover')
  recover(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.recover(id, user)
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('incidents:resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.resolve(id, user)
  }
}