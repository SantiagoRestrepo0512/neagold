import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { CSRF_COOKIE, CSRF_HEADER, CsrfService } from './csrf.service'

export const SKIP_CSRF_KEY = 'skipCsrf'
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true)

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Protección CSRF mediante "double submit cookie".
 *
 * - El SPA obtiene la cookie `ng_csrf` vía GET /api/v1/auth/csrf.
 * - Cada mutación autenticada debe enviar el mismo valor en `X-CSRF-Token`.
 * - Un atacante cross-site no puede leer ni escribir cookies en el dominio
 *   de la víctima, por lo que no puede construir el header correcto.
 * - Se excluyen las mutaciones públicas (login/register/reset) porque aún
 *   no existe cookie de sesión que pueda ser explotada; su defensa principal
 *   es SameSite=Lax + verificación de origen en producción.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly csrf: CsrfService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass()
    ])
    if (skip) return true

    const request = context.switchToHttp().getRequest<Request>()
    if (!MUTATING_METHODS.has(request.method)) return true

    const cookieToken = request.cookies?.[CSRF_COOKIE]
    const headerToken = request.headers[CSRF_HEADER]
    if (typeof headerToken !== 'string') {
      throw new ForbiddenException('Falta el token CSRF (X-CSRF-Token)')
    }
    if (typeof cookieToken !== 'string' || !this.csrf.timingSafeEqual(cookieToken, headerToken)) {
      throw new UnauthorizedException('Token CSRF inválido')
    }
    return true
  }
}