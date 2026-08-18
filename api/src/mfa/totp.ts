import { createHmac, randomBytes } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Secreto TOTP inválido')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}

/** Secreto TOTP: 20 bytes aleatorios en base32 (160 bits, sin padding). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Código TOTP (RFC 6238: HMAC-SHA1, 6 dígitos, paso de 30 s). */
export function totpFor(secret: string, timeMs: number = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
}

/** Verifica un código contra el secreto tolerando ±window pasos (30 s c/u). */
export function verifyTotp(secret: string, code: string, window = 1, timeMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  for (let offset = -window; offset <= window; offset++) {
    if (totpFor(secret, timeMs + offset * TOTP_STEP_SECONDS * 1000) === code) {
      return true
    }
  }
  return false
}

export function otpauthUrl(issuer: string, email: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Códigos de recuperación: 10 códigos Crockford de 10 caracteres. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    let code = ''
    for (let j = 0; j < 10; j++) {
      code += CROCKFORD[randomBytes(1)[0] % CROCKFORD.length]
    }
    codes.push(code)
  }
  return codes
}