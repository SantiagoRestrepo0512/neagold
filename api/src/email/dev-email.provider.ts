import { Injectable, Logger } from '@nestjs/common'
import type { EmailProvider, PasswordResetEmailData, VerificationEmailData } from './email-provider'

/**
 * Provider de desarrollo: no envía correos reales. Registra el envío en el
 * log y conserva en memoria el último correo generado (útil para depuración
 * y para que la API devuelva los enlaces de verificación/reset en dev/test).
 */
@Injectable()
export class DevEmailProvider implements EmailProvider {
  readonly kind = 'dev' as const
  private readonly logger = new Logger(DevEmailProvider.name)
  private lastEmail: { to: string; subject: string; body: string } | null = null

  async sendVerificationEmail({ to, token }: VerificationEmailData): Promise<void> {
    this.lastEmail = {
      to,
      subject: 'Verifica tu email en NEAGOLD',
      body: `Token de verificación: ${token}`
    }
    this.logger.log(`[dev-email] verificación para ${to}`)
  }

  async sendPasswordResetEmail({ to, token }: PasswordResetEmailData): Promise<void> {
    this.lastEmail = {
      to,
      subject: 'Restablece tu contraseña en NEAGOLD',
      body: `Token de restablecimiento: ${token}`
    }
    this.logger.log(`[dev-email] reset de contraseña para ${to}`)
  }

  getLastEmail() {
    return this.lastEmail
  }
}