import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator'

export class CreateProductDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Length(3, 50)
  sku!: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 200)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Length(2, 100)
  category!: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Length(2, 20)
  basePurity!: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,7}(\.\d{1,3})?$/, { message: 'Peso inválido (hasta 3 decimales)' })
  baseWeightGrams?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}