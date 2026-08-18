import { IsString, Matches } from 'class-validator'

export class CreateTransferDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'pieceId inválido' })
  pieceId!: string

  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'toUserId inválido' })
  toUserId!: string
}