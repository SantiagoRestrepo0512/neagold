import { IsOptional, IsString, MaxLength } from 'class-validator'

export class AddIncidentReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string
}