import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RequestWithUser } from '../common/decorators/current-user.decorator'
import { PERMISSIONS_KEY } from './permissions.decorator'

/**
 * RBAC basado en permisos.
 *
 * Los permisos viajan firmados dentro del access token (TTL corto, 15 min).
 * Un cambio de rol/permisos se refleja en el siguiente login/refresh sin
 * consultar la BD en cada request. Alternativa evaluada: consulta por request
 * (trade-off de latencia) - descartada para el MVP; documentado en DECISIONES.
 *
 * Semántica OR: `@RequirePermissions('a', 'b')` exige tener CUALQUIERA de los
 * permisos listados (permite combinar endpoints de staff y de cliente).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const permissions = request.user?.permissions ?? []
    if (!required.some((permission) => permissions.includes(permission))) {
      throw new ForbiddenException('No tienes permiso para esta operación')
    }
    return true
  }
}