import { IsEnum, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator'
import { CertificateType } from '@prisma/client'

export class CreateCertificateDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'pieceId inválido' })
  pieceId!: string

  @IsEnum(CertificateType)
  type!: CertificateType

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(500)
  fileUrl?: string
}