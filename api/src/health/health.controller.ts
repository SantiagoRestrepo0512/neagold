import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { Public } from '../common/decorators/public.decorator'
import { PrismaService } from '../prisma/prisma.service'

@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) }
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ready', database: 'up' }
    } catch {
      throw new ServiceUnavailableException('Base de datos no disponible')
    }
  }
}