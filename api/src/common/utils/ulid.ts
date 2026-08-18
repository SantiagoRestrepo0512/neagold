import { randomInt } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID de 26 caracteres en alfabeto Crockford (síncrono, suficiente para IDs públicos). */
export function ulid(): string {
  let time = Date.now()
  let prefix = ''
  for (let i = 0; i < 10; i++) {
    prefix = CROCKFORD[time % 32] + prefix
    time = Math.floor(time / 32)
  }
  let random = ''
  for (let i = 0; i < 16; i++) random += CROCKFORD[randomInt(0, 32)]
  return prefix + random
}