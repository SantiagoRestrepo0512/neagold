import { Transform } from 'class-transformer'
import { IsOptional, IsString, Length } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  firstName?: string

  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  lastName?: string
}