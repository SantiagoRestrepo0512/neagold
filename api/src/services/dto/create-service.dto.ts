import { IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { ServiceType } from '@prisma/client'

export class CreateServiceDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'pieceId inválido' })
  pieceId!: string

  @IsEnum(ServiceType)
  type!: ServiceType

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string
}