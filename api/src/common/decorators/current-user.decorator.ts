import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'

export interface AuthenticatedUser {
  id: string
  email: string
  permissions: string[]
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>()
    if (!request.user) {
      throw new UnauthorizedException('No autenticado')
    }
    return request.user
  }
)