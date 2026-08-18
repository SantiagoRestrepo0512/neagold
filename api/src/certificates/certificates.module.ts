import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { EventsModule } from '../events/events.module'
import { CertificatesService } from './certificates.service'
import { CertificatesController } from './certificates.controller'

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [CertificatesController],
  providers: [CertificatesService]
})
export class CertificatesModule {}