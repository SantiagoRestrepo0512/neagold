import { Module } from '@nestjs/common'
import { PiecesController } from './pieces.controller'
import { PiecesService } from './pieces.service'

@Module({
  controllers: [PiecesController],
  providers: [PiecesService],
  exports: [PiecesService]
})
export class PiecesModule {}