import { PieceStatus } from '@prisma/client'
import { IsEnum } from 'class-validator'

export class UpdatePieceStatusDto {
  @IsEnum(PieceStatus, { message: 'Estado inválido' })
  status!: PieceStatus
}