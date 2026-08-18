import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Response } from 'express'
import type { EnvConfig } from '../config/env.validation'
import { CSRF_COOKIE } from '../security/csrf.service'

export const ACCESS_COOKIE = 'ng_access'
export const REFRESH_COOKIE = 'ng_refresh'

type ResponseWithCookies = Response

@Injectable()
export class CookieService {
  private readonly secure: boolean

  constructor(config: ConfigService<EnvConfig, true>) {
    this.secure = config.get('nodeEnv', { infer: true }) === 'production'
  }

  private baseOptions(maxAgeMs: number, path: string) {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax' as const,
      maxAge: maxAgeMs,
      path
    }
  }

  setAccessToken(res: ResponseWithCookies, token: string, ttlSeconds: number): void {
    res.cookie(ACCESS_COOKIE, token, this.baseOptions(ttlSeconds * 1000, '/'))
  }

  setRefreshToken(res: ResponseWithCookies, token: string, ttlDays: number): void {
    res.cookie(
      REFRESH_COOKIE,
      token,
      this.baseOptions(ttlDays * 24 * 60 * 60 * 1000, `/api/v1/auth/refresh`)
    )
  }

  setCsrfToken(res: ResponseWithCookies, token: string): void {
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: this.secure,
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000,
      path: '/'
    })
  }

  clearAuthCookies(res: ResponseWithCookies): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' })
    res.clearCookie(REFRESH_COOKIE, { path: `/api/v1/auth/refresh` })
    res.clearCookie(CSRF_COOKIE, { path: '/' })
  }
}