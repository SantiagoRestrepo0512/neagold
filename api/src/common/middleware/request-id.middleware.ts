import { randomUUID } from 'node:crypto'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { NextFunction, Request, Response } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers[REQUEST_ID_HEADER]
    const requestId = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID()

    req.headers[REQUEST_ID_HEADER] = requestId
    ;(req as Request & { requestId: string }).requestId = requestId
    res.setHeader(REQUEST_ID_HEADER, requestId)
    next()
  }
}