import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvConfig } from '../config/env.validation'
import { DevEmailProvider } from './dev-email.provider'
import { EMAIL_PROVIDER } from './email-provider'
import { SmtpEmailProvider } from './smtp-email.provider'

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const smtpHost = config.get('smtpHost', { infer: true })
        if (smtpHost !== undefined && smtpHost.length > 0) {
          return new SmtpEmailProvider(config)
        }
        return new DevEmailProvider()
      }
    }
  ],
  exports: [EMAIL_PROVIDER]
})
export class EmailModule {}