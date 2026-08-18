import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createApp } from './app.factory'
import type { EnvConfig } from './config/env.validation'

async function bootstrap(): Promise<void> {
  const app: NestExpressApplication = await createApp()
  const config = app.get(ConfigService<EnvConfig, true>)

  const port = config.get('port', { infer: true })
  await app.listen(port)
  Logger.log(`NEAGOLD API escuchando en http://localhost:${port}`, 'Bootstrap')

  // M6: graceful shutdown. SIGTERM/SIGINT cierran el servidor HTTP y ejecutan
  // onModuleDestroy (Prisma $disconnect, worker de webhooks) antes de salir.
  if (config.get('nodeEnv', { infer: true }) !== 'test') {
    app.enableShutdownHooks(['SIGTERM', 'SIGINT'])
    Logger.log('Graceful shutdown habilitado (SIGTERM/SIGINT)', 'Bootstrap')
  }
}

void bootstrap()