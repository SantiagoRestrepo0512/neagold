import { describe, expect, it, vi } from 'vitest'
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { CsrfGuard, SkipCsrf } from './csrf.guard'
import { CsrfService } from './csrf.service'

function makeContext(
  method: string,
  cookies: Record<string, string> | undefined,
  headers: Record<string, string | string[] | undefined>
): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        cookies,
        headers
      })
    })
  } as unknown as ExecutionContext
}

describe('CsrfGuard', () => {
  it('permite métodos de lectura sin token', () => {
    const guard = new CsrfGuard(new Reflector(), new CsrfService())
    const context = makeContext('GET', undefined, {})
    expect(guard.canActivate(context)).toBe(true)
  })

  it('rechaza mutación sin header X-CSRF-Token', () => {
    const guard = new CsrfGuard(new Reflector(), new CsrfService())
    const context = makeContext('POST', { ng_csrf: 'abc' }, {})
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it('rechaza mutación con token que no coincide con la cookie', () => {
    const guard = new CsrfGuard(new Reflector(), new CsrfService())
    const context = makeContext('POST', { ng_csrf: 'abc' }, { 'x-csrf-token': 'xyz' })
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('permite mutación con doble submit correcto', () => {
    const guard = new CsrfGuard(new Reflector(), new CsrfService())
    const context = makeContext('DELETE', { ng_csrf: 'abc' }, { 'x-csrf-token': 'abc' })
    expect(guard.canActivate(context)).toBe(true)
  })

  it('respeta @SkipCsrf', () => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true)
    const guard = new CsrfGuard(reflector, new CsrfService())
    const context = makeContext('POST', undefined, {})
    expect(guard.canActivate(context)).toBe(true)
  })

  it('define la metadata SkipCsrf', () => {
    @SkipCsrf()
    class Stub {}
    expect(Reflect.getMetadata('skipCsrf', Stub)).toBe(true)
  })
})