import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer, { Transporter } from 'nodemailer'
import type { EnvConfig } from '../config/env.validation'
import type { EmailProvider, PasswordResetEmailData, VerificationEmailData } from './email-provider'

const VERIFY_SUBJECT = 'Verifica tu email en NEAGOLD'
const RESET_SUBJECT = 'Restablece tu contraseña en NEAGOLD'

function verificationBody(publicBaseUrl: string, token: string): string {
  return `Para verificar tu cuenta, abre este enlace:\n${publicBaseUrl}/auth/verify-email/${token}\n\nSi no solicitaste este correo, ignóralo.`
}

function resetBody(publicBaseUrl: string, token: string): string {
  return `Para restablecer tu contraseña, abre este enlace:\n${publicBaseUrl}/auth/reset-password/${token}\n\nEl enlace expira en 1 hora.`
}

/**
 * Provider SMTP: envía correos reales vía nodemailer. Las credenciales se leen
 * de SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM. Los enlaces apuntan a
 * PUBLIC_BASE_URL (no se devuelven en la respuesta de la API).
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly kind = 'smtp' as const
  private readonly logger = new Logger(SmtpEmailProvider.name)
  private readonly transporter: Transporter
  private readonly from: string
  private readonly publicBaseUrl: string

  constructor(config: ConfigService<EnvConfig, true>) {
    this.from = config.get('emailFrom', { infer: true }) ?? 'NEAGOLD <no-reply@neagold.com>'
    this.publicBaseUrl = config.get('publicBaseUrl', { infer: true })
    this.transporter = nodemailer.createTransport({
      host: config.get('smtpHost', { infer: true }),
      port: config.get('smtpPort', { infer: true }) ?? 587,
      secure: (config.get('smtpPort', { infer: true }) ?? 587) === 465,
      auth: {
        user: config.get('smtpUser', { infer: true }),
        pass: config.get('smtpPass', { infer: true })
      }
    })
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, text: body })
    this.logger.log(`email enviado a ${to}: ${subject}`)
  }

  async sendVerificationEmail({ to, token }: VerificationEmailData): Promise<void> {
    await this.send(to, VERIFY_SUBJECT, verificationBody(this.publicBaseUrl, token))
  }

  async sendPasswordResetEmail({ to, token }: PasswordResetEmailData): Promise<void> {
    await this.send(to, RESET_SUBJECT, resetBody(this.publicBaseUrl, token))
  }
}