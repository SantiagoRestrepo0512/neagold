import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EnvConfig } from '../config/env.validation'
import { WebhookTargetValidator } from './webhook-target.validator'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
import { lookup } from 'node:dns/promises'

const mockedLookup = lookup as unknown as ReturnType<typeof vi.fn>

function makeValidator(nodeEnv: string): WebhookTargetValidator {
  const config = new ConfigService({ nodeEnv }) as unknown as ConfigService<EnvConfig, true>
  return new WebhookTargetValidator(config)
}

function expectRejected(promise: Promise<void>, fragment: string): Promise<void> {
  return promise.then(
    () => {
      throw new Error('La validación debería haber fallado')
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).message).toContain(fragment)
    }
  )
}

describe('WebhookTargetValidator (anti-SSRF)', () => {
  beforeEach(() => {
    mockedLookup.mockReset()
  })

  it('rechaza protocolos que no sean http/https', async () => {
    const validator = makeValidator('development')
    await expectRejected(
      validator.validate('ftp://example.com/ng'),
      'debe usar http o https'
    )
  })

  it('rechaza URLs con credenciales embebidas', async () => {
    const validator = makeValidator('development')
    await expectRejected(
      validator.validate('https://user:pass@example.com/ng'),
      'no puede incluir credenciales'
    )
  })

  it('rechaza puertos sensibles (SSRF hacia servicios internos)', async () => {
    const validator = makeValidator('development')
    await expectRejected(validator.validate('http://example.com:5432/ng'), 'Puerto no permitido')
  })

  it('exige https en producción', async () => {
    const validator = makeValidator('production')
    await expectRejected(validator.validate('http://example.com/ng'), 'debe usar https')
  })

  it('en producción rechaza hosts que resuelven a loopback/privadas', async () => {
    const validator = makeValidator('production')
    mockedLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expectRejected(
      validator.validate('https://internal.local/ng'),
      'no puede ser una dirección privada o reservada'
    )

    mockedLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    await expectRejected(
      validator.validate('https://intranet.example.com/ng'),
      'no puede ser una dirección privada o reservada'
    )

    mockedLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    await expectRejected(
      validator.validate('https://metadata.example.com/ng'),
      'no puede ser una dirección privada o reservada'
    )
  })

  it('en producción rechaza hosts sin resolución DNS', async () => {
    const validator = makeValidator('production')
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expectRejected(
      validator.validate('https://no-such-host.invalid/ng'),
      'No se pudo resolver'
    )
  })

  it('en producción acepta un destino público con DNS válido', async () => {
    const validator = makeValidator('production')
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(validator.validate('https://hooks.example.com/ng')).resolves.toBeUndefined()
    expect(mockedLookup).toHaveBeenCalledWith('hooks.example.com', { all: true, verbatim: true })
  })

  it('en desarrollo permite destinos de loopback sin consultar DNS', async () => {
    const validator = makeValidator('development')
    await expect(validator.validate('http://127.0.0.1:9000/hooks/ng')).resolves.toBeUndefined()
    expect(mockedLookup).not.toHaveBeenCalled()
  })
})