import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Request, Response } from 'express'
import { Observable, of } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'

export const IDEMPOTENCY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_REPLAYED_HEADER = 'x-idempotency-replayed'

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const TTL_MS = 24 * 60 * 60 * 1000
const IN_PROGRESS = 0
const POLL_TIMEOUT_MS = 5000
const POLL_INTERVAL_MS = 25

interface UserRequest extends Request {
  user?: { id?: string }
}

/**
 * Idempotencia de mutaciones vía cabecera `Idempotency-Key`.
 *
 * - Si ya existe una respuesta almacenada para (user, key, path) se rejuega
 *   tal cual (mismo status y body), con `X-Idempotency-Replayed: true`.
 * - La inserción del "slot" (responseStatus = 0) antes de ejecutar el handler
 *   es el punto de serialización: dos peticiones concurrentes con la misma
 *   clave compiten por el UNIQUE y una espera a que la otra complete para
 *   devolver su misma respuesta.
 * - Solo se almacenan respuestas 2xx; errores borran el slot para permitir
 *   reintentar con la misma clave.
 * - Los slots expiran a las 24 h.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name)

  constructor(private readonly prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<UserRequest>()
    const response = context.switchToHttp().getResponse<Response>()

    const rawKey = request.headers[IDEMPOTENCY_HEADER]
    if (!MUTATING_METHODS.has(request.method) || typeof rawKey !== 'string') {
      return next.handle()
    }

    const key = rawKey.trim()
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('Idempotency-Key inválida (8-64 caracteres alfanuméricos, _ o -)')
    }

    const userId = request.user?.id ?? null
    const requestPath = request.path

    let slot: { id: string; responseStatus: number } | null = null

    try {
      const existing = await this.prisma.idempotency_keys.findFirst({
        where: { userId, key, requestPath }
      })
      if (existing && existing.expiresAt <= new Date()) {
        await this.prisma.idempotency_keys.delete({ where: { id: existing.id } })
      } else if (existing && existing.responseStatus !== IN_PROGRESS) {
        return this.replay(response, existing.responseStatus, existing.responseBody)
      }
    } catch (error) {
      this.logger.warn(`Idempotencia: fallo de lectura, se continúa sin deduplicar: ${String(error)}`)
      return next.handle()
    }

    if (!slot) {
      try {
        slot = await this.prisma.idempotency_keys.create({
          data: {
            userId,
            key,
            requestPath,
            responseStatus: IN_PROGRESS,
            responseBody: Prisma.JsonNull,
            expiresAt: new Date(Date.now() + TTL_MS)
          }
        })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const winner = await this.pollForResult(userId, key, requestPath)
          if (winner) {
            return this.replay(response, winner.responseStatus, winner.responseBody)
          }
          await this.prisma.idempotency_keys.deleteMany({
            where: { userId, key, requestPath, responseStatus: IN_PROGRESS }
          })
          try {
            slot = await this.prisma.idempotency_keys.create({
              data: {
                userId,
                key,
                requestPath,
                responseStatus: IN_PROGRESS,
                responseBody: Prisma.JsonNull,
                expiresAt: new Date(Date.now() + TTL_MS)
              }
            })
          } catch (secondError) {
            if (!(secondError instanceof Prisma.PrismaClientKnownRequestError && secondError.code === 'P2002')) {
              throw secondError
            }
          }
        } else {
          this.logger.warn(`Idempotencia: fallo al reservar slot, se continúa sin deduplicar: ${String(error)}`)
          return next.handle()
        }
      }
    }

    if (!slot) {
      return next.handle()
    }

    const slotId = slot.id
    let capturedBody: unknown = null

    const json = response.json.bind(response)
    response.json = ((body: unknown) => {
      capturedBody = body
      return json(body)
    }) as typeof response.json

    response.on('finish', () => {
      void (async () => {
        try {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const storedBody = capturedBody === null ? null : JSON.parse(JSON.stringify(capturedBody))
            await this.prisma.idempotency_keys.updateMany({
              where: { id: slotId, responseStatus: IN_PROGRESS },
              data: { responseStatus: response.statusCode, responseBody: storedBody ?? Prisma.JsonNull }
            })
          } else {
            await this.prisma.idempotency_keys.deleteMany({ where: { id: slotId, responseStatus: IN_PROGRESS } })
          }
        } catch (error) {
          this.logger.error(`Idempotencia: no se pudo persistir el resultado: ${String(error)}`)
        }
      })()
    })

    return next.handle()
  }

  private replay(response: Response, status: number, body: unknown): Observable<unknown> {
    response.status(status).setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true')
    return of(body)
  }

  private async pollForResult(
    userId: string | null,
    key: string,
    requestPath: string
  ): Promise<{ responseStatus: number; responseBody: unknown } | null> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const record = await this.prisma.idempotency_keys.findFirst({
        where: { userId, key, requestPath }
      })
      if (record && record.responseStatus !== IN_PROGRESS) {
        return { responseStatus: record.responseStatus, responseBody: record.responseBody }
      }
      if (!record) {
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    return null
  }
}
