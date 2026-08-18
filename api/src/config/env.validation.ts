export interface EnvConfig {
  databaseUrl: string
  nodeEnv: string
  port: number
  jwtAccessSecret: string
  jwtAccessTtlSeconds: number
  jwtIssuer: string
  jwtAudience: string
  sessionTtlDays: number
  corsOrigins: string[]
  throttleTtlSeconds: number
  throttleLimit: number
  loginThrottleLimit: number
  loginThrottleTtlMs: number
  publicBaseUrl: string
  mfaSecretEncryptionKey: string
  totpIssuer: string
  verifyOwnerName: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  emailFrom?: string
  webhookDeliveryTimeoutMs: number
  webhookDeliveryPollMs: number
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const errors: string[] = []
  const nodeEnv = (config.NODE_ENV as string) ?? 'development'
  const isProduction = nodeEnv === 'production'

  const required = (key: string): string => {
    const value = config[key]
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${key} es obligatorio`)
      return ''
    }
    return value
  }

  const number = (key: string, fallback: number): number => {
    const value = config[key]
    if (value === undefined || value === '') return fallback
    const parsed = Number(value)
    if (Number.isNaN(parsed) || parsed <= 0) {
      errors.push(`${key} debe ser un número positivo`)
      return fallback
    }
    return parsed
  }

  const jwtAccessSecret = required('JWT_ACCESS_SECRET')
  if (jwtAccessSecret.length > 0 && jwtAccessSecret.length < 32) {
    errors.push('JWT_ACCESS_SECRET debe tener al menos 32 caracteres')
  }

  const mfaSecretEncryptionKey = required('MFA_SECRET_ENCRYPTION_KEY')
  if (mfaSecretEncryptionKey.length > 0 && !/^[0-9a-fA-F]{64}$/.test(mfaSecretEncryptionKey)) {
    errors.push('MFA_SECRET_ENCRYPTION_KEY debe ser un hex de 32 bytes (64 caracteres)')
  }

  // L4 fail-fast: en producción no se admiten placeholders de desarrollo ni
  // configuraciones que degradarían silenciosamente la seguridad.
  if (isProduction) {
    if (jwtAccessSecret.startsWith('dev-only-')) {
      errors.push('JWT_ACCESS_SECRET es un placeholder de desarrollo; genera uno real')
    }
    if (mfaSecretEncryptionKey === 'cambiar-por-hex-de-64-caracteres') {
      errors.push('MFA_SECRET_ENCRYPTION_KEY es un placeholder; genera un hex de 64 caracteres')
    }
    const corsOriginsProd = String(config.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
    if (corsOriginsProd.length === 0) {
      errors.push('CORS_ORIGINS es obligatorio en producción (lista de orígenes permitidos)')
    }
    const smtpHostProd =
      typeof config.SMTP_HOST === 'string' && config.SMTP_HOST.length > 0
        ? config.SMTP_HOST
        : undefined
    if (smtpHostProd === undefined) {
      errors.push('SMTP_HOST es obligatorio en producción (los emails no pueden ir al provider de desarrollo)')
    }
  }

  const verifyOwnerName = String(config.VERIFY_OWNER_NAME ?? '').toLowerCase() === 'true'

  const smtpHost = typeof config.SMTP_HOST === 'string' ? config.SMTP_HOST : undefined
  const smtpPort =
    config.SMTP_PORT === undefined || config.SMTP_PORT === ''
      ? undefined
      : number('SMTP_PORT', 587)
  const smtpUser = typeof config.SMTP_USER === 'string' ? config.SMTP_USER : undefined
  const smtpPass = typeof config.SMTP_PASS === 'string' ? config.SMTP_PASS : undefined
  const emailFrom =
    typeof config.EMAIL_FROM === 'string' && config.EMAIL_FROM.length > 0
      ? config.EMAIL_FROM
      : undefined
  const smtpConfigured =
    smtpHost !== undefined && smtpHost.length > 0
  if (smtpConfigured && (smtpUser === undefined || smtpPass === undefined || emailFrom === undefined)) {
    errors.push(
      'SMTP_HOST requiere SMTP_USER, SMTP_PASS y EMAIL_FROM (o elimina SMTP_HOST para usar el provider de desarrollo)'
    )
  }

  const databaseUrl = required('DATABASE_URL')

  const corsOrigins = String(config.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (errors.length > 0) {
    throw new Error(`Configuración inválida:\n- ${errors.join('\n- ')}`)
  }

  return {
    databaseUrl,
    nodeEnv,
    port: number('PORT', 3000),
    jwtAccessSecret,
    jwtAccessTtlSeconds: number('JWT_ACCESS_TTL_SECONDS', 900),
    jwtIssuer: String(config.JWT_ISSUER ?? 'neagold'),
    jwtAudience: String(config.JWT_AUDIENCE ?? 'neagold-web'),
    sessionTtlDays: number('SESSION_TTL_DAYS', 30),
    corsOrigins,
    throttleTtlSeconds: number('THROTTLE_TTL_SECONDS', 60),
    throttleLimit: number('THROTTLE_LIMIT', 120),
    loginThrottleLimit: number('LOGIN_THROTTLE_LIMIT', 15),
    loginThrottleTtlMs: number('LOGIN_THROTTLE_TTL_MS', 60000),
    publicBaseUrl: String(config.PUBLIC_BASE_URL ?? 'https://neagold.com'),
    mfaSecretEncryptionKey,
    totpIssuer: String(config.TOTP_ISSUER ?? 'NEAGOLD'),
    verifyOwnerName,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    emailFrom,
    webhookDeliveryTimeoutMs: number('WEBHOOK_DELIVERY_TIMEOUT_MS', 5000),
    webhookDeliveryPollMs: number('WEBHOOK_DELIVERY_POLL_MS', 10000)
  }
}