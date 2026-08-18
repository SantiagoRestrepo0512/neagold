import { describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PermissionsGuard } from './permissions.guard'
import { RequirePermissions } from './permissions.decorator'

function makeContext(permissions: string[]) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', email: 'a@b.c', permissions } })
    })
  } as never
}

describe('PermissionsGuard', () => {
  it('permite acceso sin permisos requeridos', () => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined)
    const guard = new PermissionsGuard(reflector)
    expect(guard.canActivate(makeContext([]))).toBe(true)
  })

  it('permite cuando el usuario tiene el permiso', () => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['pieces:read_own'])
    const guard = new PermissionsGuard(reflector)
    expect(guard.canActivate(makeContext(['pieces:read_own']))).toBe(true)
  })

  it('rechaza cuando falta un permiso requerido', () => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['audit:read'])
    const guard = new PermissionsGuard(reflector)
    expect(() => guard.canActivate(makeContext(['pieces:read_own']))).toThrow(ForbiddenException)
  })

  it('rechaza usuarios sin permisos en el token', () => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['pieces:read_own'])
    const guard = new PermissionsGuard(reflector)
    expect(() => guard.canActivate(makeContext([]))).toThrow(ForbiddenException)
  })

  it('define la metadata RequirePermissions', () => {
    @RequirePermissions('audit:read', 'users:list')
    class Stub {}
    expect(Reflect.getMetadata('permissions', Stub)).toEqual(['audit:read', 'users:list'])
  })
})