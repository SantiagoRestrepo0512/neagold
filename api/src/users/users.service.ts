import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { UpdateProfileDto } from './dto/update-profile.dto'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true }
                }
              }
            }
          }
        }
      }
    })
    if (!user) throw new NotFoundException('Usuario no encontrado')

    const roles = user.userRoles.map(({ role }) => role.name)
    const permissions = [
      ...new Set(
        user.userRoles.flatMap(({ role }) =>
          role.rolePermissions.map(({ permission }) => permission.code)
        )
      )
    ].sort()

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      roles,
      permissions
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName })
      }
    })
    return this.getProfile(userId)
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.sessions.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        familyId: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true
      }
    })
    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      createdAt: session.createdAt,
      isCurrent: Boolean(currentSessionId && session.id === currentSessionId)
    }))
  }

  async revokeSession(userId: string, sessionId: string, currentSessionId?: string) {
    const session = await this.prisma.sessions.findFirst({
      where: { id: sessionId, userId }
    })
    if (!session) {
      // No revelamos existencia de sesiones ajenas (anti-enumeración)
      throw new NotFoundException('Sesión no encontrada')
    }
    await this.prisma.sessions.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    })
    return { revoked: true, isCurrent: sessionId === currentSessionId }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    return this.authService.changePassword(userId, currentPassword, newPassword)
  }

  async listActiveUsers(search?: string) {
    return this.prisma.users.findMany({
      where: {
        status: 'ACTIVE',
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: { firstName: 'asc' },
      take: 25,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true
      }
    })
  }
}