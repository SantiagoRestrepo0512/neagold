import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { IncidentType } from '@prisma/client'

export class CreateIncidentDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'pieceId inválido' })
  pieceId!: string

  @IsEnum(IncidentType)
  type!: IncidentType

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string
}