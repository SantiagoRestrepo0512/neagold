import { IsDateString, IsOptional, IsString, Matches } from 'class-validator'

export class CreateSaleDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'pieceId inválido' })
  pieceId!: string

  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'buyerId inválido' })
  buyerId!: string

  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'Monto inválido (hasta 2 decimales)' })
  amount!: string

  @IsOptional()
  @IsDateString()
  saleDate?: string
}