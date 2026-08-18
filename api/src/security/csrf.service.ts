import { Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

export const CSRF_COOKIE = 'ng_csrf'
export const CSRF_HEADER = 'x-csrf-token'

@Injectable()
export class CsrfService {
  generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}