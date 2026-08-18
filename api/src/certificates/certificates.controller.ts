import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res
} from '@nestjs/common'
import { Response } from 'express'
import { AuditAction, AuditService } from '../audit/audit.service'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateCertificateDto } from './dto/create-certificate.dto'
import { CertificatesService } from './certificates.service'

@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly certificatesService: CertificatesService,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('certificates:create')
  async create(@Body() dto: CreateCertificateDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.certificatesService.create(dto, user.id)
    this.audit.record(user.id, {
      action: AuditAction.CERTIFICATE_ISSUED,
      entityType: 'certificate',
      entityId: result.certificate.id,
      metadata: { certificateNumber: result.certificate.certificateNumber }
    })
    return result
  }

  @Get()
  @RequirePermissions('certificates:read', 'certificates:read_own')
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.list(query, user)
  }

  @Get(':id')
  @RequirePermissions('certificates:read', 'certificates:read_own')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.findById(id, user)
  }

  @Get(':id/download')
  @RequirePermissions('certificates:read', 'certificates:download_own')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const { document, documentHash } = await this.certificatesService.download(id, user)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment')
    res.setHeader('X-Document-SHA256', documentHash)
    return document
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('certificates:revoke')
  async revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const certificate = await this.certificatesService.revoke(id)
    this.audit.record(user.id, {
      action: AuditAction.CERTIFICATE_REVOKED,
      entityType: 'certificate',
      entityId: id,
      metadata: { certificateNumber: certificate.certificateNumber }
    })
    return certificate
  }
}