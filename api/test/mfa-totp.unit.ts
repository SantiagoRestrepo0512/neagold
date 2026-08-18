import { describe, expect, it } from 'vitest'
import {
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUrl,
  totpFor,
  verifyTotp
} from '../src/mfa/totp'

describe('totp (RFC 6238)', () => {
  // Apéndice B del RFC 6238: secreto "12345678901234567890" (SHA1).
  // Los vectores oficiales usan 8 dígitos; el código de 6 dígitos se obtiene
  // truncando (la implementación usa 6 por defecto).
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

  it('genera los códigos del RFC para los contadores de prueba', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130']
    ]
    for (const [timeSeconds, expected] of vectors) {
      expect(totpFor(SECRET, timeSeconds * 1000)).toBe(expected)
    }
  })

  it('verifyTotp acepta códigos del paso actual y tolera ±1 paso', () => {
    const now = 1234567890 * 1000
    expect(verifyTotp(SECRET, totpFor(SECRET, now), 1, now)).toBe(true)
    expect(verifyTotp(SECRET, totpFor(SECRET, now + 30_000), 1, now)).toBe(true)
    expect(verifyTotp(SECRET, totpFor(SECRET, now - 30_000), 1, now)).toBe(true)
  })

  it('verifyTotp rechaza códigos inválidos, viejos (>1 paso) y mal formados', () => {
    const now = 1234567890 * 1000
    expect(verifyTotp(SECRET, '000000', 1, now)).toBe(false)
    expect(verifyTotp(SECRET, totpFor(SECRET, now + 90_000), 1, now)).toBe(false)
    expect(verifyTotp(SECRET, totpFor(SECRET, now - 90_000), 1, now)).toBe(false)
    expect(verifyTotp(SECRET, '12345', 1, now)).toBe(false)
    expect(verifyTotp(SECRET, '1234567', 1, now)).toBe(false)
    expect(verifyTotp(SECRET, 'abcdef', 1, now)).toBe(false)
  })

  it('generateTotpSecret produce un secreto base32 de 20 bytes (32 chars, sin padding)', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    const another = generateTotpSecret()
    expect(another).not.toBe(secret)
  })

  it('otpauthUrl incluye issuer, label y parámetros estándar', () => {
    const url = otpauthUrl('NEAGOLD', 'user@example.com', SECRET)
    expect(url).toContain('otpauth://totp/')
    expect(url).toContain('secret=' + SECRET)
    expect(url).toContain('issuer=NEAGOLD')
    expect(url).toContain('algorithm=SHA1')
    expect(url).toContain('digits=6')
    expect(url).toContain('period=30')
  })

  it('generateRecoveryCodes produce 10 códigos Crockford de 10 caracteres', () => {
    const codes = generateRecoveryCodes(10)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    }
  })
})