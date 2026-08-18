import { Transform } from 'class-transformer'
import { IsDateString, IsOptional, IsString, Length, Matches } from 'class-validator'

export class RegisterPieceDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'productId inválido' })
  productId!: string

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^NG-INT-\d{4}-\d{1,6}$/, {
    message: 'internalId debe seguir el formato NG-INT-{año}-{secuencia}'
  })
  internalId?: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'material inválido (solo mayúsculas, números y guión bajo)' })
  material!: string

  @IsString()
  @Matches(/^\d{1,7}(\.\d{1,3})?$/, { message: 'Peso inválido (hasta 3 decimales)' })
  weightGrams!: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Length(2, 20)
  purity!: string

  @IsDateString()
  manufacturingDate!: string
}