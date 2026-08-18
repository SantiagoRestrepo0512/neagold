import { Transform } from 'class-transformer'
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator'

export class RegisterDto {
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string

  @IsString()
  @Length(12, 128, { message: 'La contraseña debe tener entre 12 y 128 caracteres' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/,
    { message: 'La contraseña debe incluir mayúsculas, minúsculas, números y símbolos' }
  )
  password!: string

  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  firstName!: string

  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  lastName!: string
}