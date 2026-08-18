import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { EnvConfig } from '../config/env.validation'

const PORT_BLOCKLIST = new Set([21, 22, 23, 25, 53, 137, 138, 139, 445, 1433, 1521, 3306, 5432, 6379, 27017, 11211])

function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) return false
  if (ip.includes(':')) {
    const lower = ip.toLowerCase()
    if (lower.startsWith('::1')) return true
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7))
    if (lower.startsWith('fe80')) return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('2001:db8')) return true
    return false
  }
  const parts = ip.split('.').map(Number)
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 ||
    a === 255
  )
}

/**
 * Validación del destino de un webhook saliente (anti-SSRF).
 * - Solo http/https; sin credenciales embebidas en la URL.
 * - HTTPS obligatorio en producción.
 * - Resuelve el hostname y rechaza direcciones privadas/reservadas
 *   (loopback, link-local, multicast, rangos internos) y puertos sensibles.
 * - Se evalúa tanto al crear/editar como en el momento de la entrega
 *   (mitigación básica de DNS rebinding: la entrega re-resuelve).
 */
@Injectable()
export class WebhookTargetValidator {
  private readonly nodeEnv: string

  constructor(config: ConfigService<EnvConfig, true>) {
    this.nodeEnv = config.get('nodeEnv', { infer: true })
  }

  async validate(url: string): Promise<void> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new BadRequestException('URL de webhook inválida')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('La URL del webhook debe usar http o https')
    }
    if (this.nodeEnv === 'production' && parsed.protocol !== 'https:') {
      throw new BadRequestException('En producción el webhook debe usar https')
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('La URL del webhook no puede incluir credenciales')
    }
    if (parsed.port && PORT_BLOCKLIST.has(Number(parsed.port))) {
      throw new BadRequestException('Puerto no permitido para webhooks')
    }

    // En desarrollo/pruebas se permiten destinos de loopback (SMTP local,
    // servidores de captura en tests). En producción se valida la resolución
    // DNS y se rechazan direcciones privadas/reservadas (anti-SSRF).
    if (this.nodeEnv === 'production') {
      let addresses: string[]
      try {
        const result = await lookup(parsed.hostname, { all: true, verbatim: true })
        addresses = result.map((entry) => entry.address)
      } catch {
        throw new BadRequestException('No se pudo resolver el host del webhook')
      }
      if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address))) {
        throw new BadRequestException('El destino del webhook no puede ser una dirección privada o reservada')
      }
    }
  }
}