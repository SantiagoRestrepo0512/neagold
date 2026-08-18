import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import type { EnvConfig } from './config/env.validation'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const config = app.get(ConfigService<EnvConfig, true>)

  app.set('trust proxy', 1)
  // M5: helmet con CSP explícita para la API (JSON/HTML propio, sin terceros).
  // HSTS y upgrade-insecure-requests solo en producción (dev/test usan http local).
  const isProduction = config.get('nodeEnv', { infer: true }) === 'production'
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null
        }
      },
      hsts: isProduction ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
      crossOriginEmbedderPolicy: false
    })
  )
  app.use(cookieParser())

  app.enableCors({
    origin: config.get('corsOrigins', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key']
  })

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready', 'verify/{*splat}'] })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false }
    })
  )

  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NEAGOLD API')
      .setDescription('Plataforma de identidad digital y trazabilidad de joyería')
      .setVersion('0.3.0')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api/docs', app, document)
  }

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