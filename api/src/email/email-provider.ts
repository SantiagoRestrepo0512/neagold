export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER')

export interface VerificationEmailData {
  to: string
  token: string
}

export interface PasswordResetEmailData {
  to: string
  token: string
}

export interface EmailProvider {
  readonly kind: 'dev' | 'smtp'
  sendVerificationEmail(data: VerificationEmailData): Promise<void>
  sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void>
}