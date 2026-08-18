import { Transform } from 'class-transformer'
import { IsString, Matches } from 'class-validator'

export class RedeemClaimDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^NG-CLAIM-\d{4}-[A-F0-9]{32}$/, { message: 'Código de reclamación inválido' })
  code!: string
}