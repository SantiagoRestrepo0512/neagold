import { IsNotEmpty, IsString, Length, Matches } from 'class-validator'

export class VerifySetupDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z2-7]+$/, { message: 'Secreto TOTP inválido' })
  secret: string

  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code: string
}

export class DisableMfaDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code: string
}

export class VerifyChallengeDto {
  @IsString()
  @IsNotEmpty()
  challengeToken: string

  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code: string
}

export class RecoverChallengeDto {
  @IsString()
  @IsNotEmpty()
  challengeToken: string

  @IsString()
  @Length(10, 10, { message: 'El código de recuperación debe tener 10 caracteres' })
  recoveryCode: string
}