import { Transform } from 'class-transformer'
import { IsEmail } from 'class-validator'

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email inválido' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string
}