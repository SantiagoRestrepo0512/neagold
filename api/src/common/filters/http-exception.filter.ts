import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common'
import { Response } from 'express'

export interface ApiErrorBody {
  statusCode: number
  code: string
  message: string
  details?: unknown
  requestId?: string
}

const ERROR_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY'
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request & { requestId?: string }>()

    const requestId = request.requestId
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR
    let code = 'INTERNAL_ERROR'
    let message = 'Error interno del servidor'
    let details: unknown

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') {
        message = body
      } else if (typeof body === 'object' && body !== null) {
        const bodyRecord = body as Record<string, unknown>
        message = String(bodyRecord['message'] ?? message)
        details = bodyRecord['details']
        if (typeof bodyRecord['code'] === 'string') {
          code = bodyRecord['code']
        }
        // Un statusCode explícito en el body del exception (p. ej. el 423
        // de ACCOUNT_LOCKED) define el status de la respuesta.
        if (typeof bodyRecord['statusCode'] === 'number') {
          statusCode = bodyRecord['statusCode']
        }
      }
      code = ERROR_CODES[statusCode] ?? code
      if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
        code = 'RATE_LIMITED'
        message = 'Demasiadas peticiones. Inténtalo de nuevo más tarde.'
      }
    } else {
      const err = exception as { code?: string; meta?: { code?: string }; message?: string }
      // Conflictos de unicidad (P2002) y violaciones de integridad
      if (err?.code === 'P2002') {
        statusCode = HttpStatus.CONFLICT
        code = 'CONFLICT'
        message = 'Ya existe un registro con ese valor único'
        const meta = err.meta as { target?: string[] } | undefined
        details = { fields: meta?.target }
      } else if (err?.code === 'P2025') {
        statusCode = HttpStatus.NOT_FOUND
        code = 'NOT_FOUND'
        message = 'Recurso no encontrado'
      } else if (err?.code === 'P2003') {
        // Violación de FK: la entidad relacionada no existe
        statusCode = HttpStatus.BAD_REQUEST
        code = 'VALIDATION_ERROR'
        message = 'Entidad relacionada no encontrada'
      } else if (err?.code === 'P2014') {
        // Violación de relación (p. ej. relación 1:1 ya ocupada)
        statusCode = HttpStatus.CONFLICT
        code = 'CONFLICT'
        message = 'La operación viola una relación de integridad'
      } else {
        this.logger.error(
          `[${requestId}] ${request.method} ${request.url} -> ${err?.message ?? exception}`
        )
      }
    }

    const body: ApiErrorBody = { statusCode, code, message, requestId }
    if (details !== undefined) body.details = details
    response.status(statusCode).json(body)
  }
}