import { Global, Module } from '@nestjs/common'
import { CsrfGuard } from './csrf.guard'
import { CsrfService } from './csrf.service'

@Global()
@Module({
  providers: [CsrfService, CsrfGuard],
  exports: [CsrfService, CsrfGuard]
})
export class SecurityModule {}