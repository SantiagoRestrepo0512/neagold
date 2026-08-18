import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildCertificateDocument,
  newCertificateNumber
} from '../src/certificates/certificates.service'

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

const baseInput = {
  certificateNumber: 'NG-CERT-2026-ABCDEF123456',
  type: 'AUTHENTICITY',
  issuedAt: new Date('2026-08-15T10:00:00.000Z'),
  issuedById: '11111111-1111-4111-8111-111111111111',
  serialNumber: 'NG-2026-000001',
  publicId: '01JTESTPIECE00000000000001AA',
  material: 'oro',
  purity: '18k',
  weightGrams: 5.2,
  manufacturingDate: '2026-01-15T00:00:00.000Z',
  identityPublicToken: 'a'.repeat(64),
  identityHash: 'b'.repeat(64)
}

describe('certificates.service (unit)', () => {
  it('genera números de certificado únicos con formato NG-CERT-{año}-{12 hex}', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const value = newCertificateNumber(2026)
      expect(value).toMatch(/^NG-CERT-2026-[0-9A-F]{12}$/)
      seen.add(value)
    }
    expect(seen.size).toBe(200)
    expect(newCertificateNumber(2027)).toMatch(/^NG-CERT-2027-/)
  })

  it('canonicaliza con claves ordenadas y hash determinístico', () => {
    const document = buildCertificateDocument(baseInput)
    const parsed = JSON.parse(document)
    expect(Object.keys(parsed)).toEqual(['certificateNumber', 'issuedAt', 'issuedById', 'piece', 'type'])
    expect(Object.keys(parsed.piece)).toEqual([
      'identity',
      'manufacturingDate',
      'material',
      'publicId',
      'purity',
      'serialNumber',
      'weightGrams'
    ])
    expect(Object.keys(parsed.piece.identity)).toEqual(['identityHash', 'publicToken'])

    const same = buildCertificateDocument(baseInput)
    const differentWeight = buildCertificateDocument({ ...baseInput, weightGrams: 5.3 })
    expect(sha256(document)).toBe(sha256(same))
    expect(sha256(document)).not.toBe(sha256(differentWeight))
  })
})