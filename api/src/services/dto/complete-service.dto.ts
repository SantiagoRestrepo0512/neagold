import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CompleteServiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}