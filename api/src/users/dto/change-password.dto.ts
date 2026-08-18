import { IsString, Length, Matches, MinLength } from 'class-validator'

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string

  @IsString()
  @Length(12, 128, { message: 'La contraseña debe tener entre 12 y 128 caracteres' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/,
    { message: 'La contraseña debe incluir mayúsculas, minúsculas, números y símbolos' }
  )
  newPassword!: string
}