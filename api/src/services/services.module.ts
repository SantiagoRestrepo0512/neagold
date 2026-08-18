import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { EventsModule } from '../events/events.module'
import { ServicesService } from './services.service'
import { ServicesController } from './services.controller'

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ServicesController],
  providers: [ServicesService]
})
export class ServicesModule {}