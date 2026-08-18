import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor
} from '@nestjs/common'
import { Request, Response } from 'express'
import { Observable, tap } from 'rxjs'

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'refreshToken',
  'csrfToken',
  'mfaCode',
  'recoveryCode'
])

/** Rutas cuyo último segmento es un token opaco: nunca loguear el valor. */
const TOKEN_PATH_SEGMENTS = ['verify-email', 'reset-password', 'verify']

function redactBody(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body
  if (Array.isArray(body)) return body.map((item) => redactBody(item))
  const record = body as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_BODY_KEYS.has(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object') {
      result[key] = redactBody(value)
    } else {
      result[key] = value
    }
  }
  return result
}

/** Enmascara el último segmento de URLs con tokens (verify-email/reset-password/verify). */
function sanitizeUrl(url: string): string {
  const [path, query] = url.split('?', 2)
  const segments = path.split('/').filter((segment) => segment.length > 0)
  if (
    segments.length >= 2 &&
    TOKEN_PATH_SEGMENTS.includes(segments[segments.length - 2]) &&
    segments[segments.length - 1].length > 0
  ) {
    segments[segments.length - 1] = '[REDACTED]'
    return `/${segments.join('/')}${query !== undefined ? `?${query}` : ''}`
  }
  return url
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>()
    const response = context.switchToHttp().getResponse<Response>()
    const startedAt = Date.now()

    return next.handle().pipe(
      tap({
next: () => {
          const body = request.body !== undefined ? redactBody(request.body) : undefined
          this.logger.log(
            `[${request.requestId}] ${request.method} ${sanitizeUrl(request.originalUrl)} -> ${response.statusCode} (${
              Date.now() - startedAt
            }ms)${body !== undefined ? ` body=${JSON.stringify(body)}` : ''}`
          )
        },
        error: () => {
          this.logger.warn(
            `[${request.requestId}] ${request.method} ${sanitizeUrl(request.originalUrl)} -> error (${
              Date.now() - startedAt
            }ms)`
          )
        }
      })
    )
  }
}