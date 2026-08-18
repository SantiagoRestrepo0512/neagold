import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { EnvConfig } from '../../config/env.validation'
import { ACCESS_COOKIE } from '../cookies.service'

export interface JwtPayload {
  sub: string
  email: string
  permissions: string[]
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<EnvConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          const token = request.cookies?.[ACCESS_COOKIE]
          return typeof token === 'string' && token.length > 0 ? token : null
        }
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('jwtAccessSecret', { infer: true }),
      issuer: config.get('jwtIssuer', { infer: true }),
      audience: config.get('jwtAudience', { infer: true })
    })
  }

  validate(payload: JwtPayload): { id: string; email: string; permissions: string[] } {
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Token inválido')
    }
    return {
      id: payload.sub,
      email: payload.email,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : []
    }
  }
}