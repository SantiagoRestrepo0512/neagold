import { Module } from '@nestjs/common'
import { IncidentsModule } from '../incidents/incidents.module'
import { TransfersController } from './transfers.controller'
import { TransfersService } from './transfers.service'

@Module({
  imports: [IncidentsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService]
})
export class TransfersModule {}