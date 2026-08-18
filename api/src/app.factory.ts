import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import type { EnvConfig } from './config/env.validation'

/**
 * Fábrica de la aplicación NestJS con toda la configuración común
 * (helmet, cookies, CORS, prefijo global, pipes, swagger).
 *
 * Usada por main.ts (servidor HTTP) y por el entry serverless de Vercel.
 * - Sin `expressInstance`: Nest crea su propio listener (local/Docker).
 * - Con `expressInstance`: se monta la app sobre un server Express ya
 *   creado (serverless), sin `listen()`.
 */
export async function createApp(
  expressInstance?: ReturnType<typeof import('express')>
): Promise<NestExpressApplication> {
  const app = expressInstance
    ? await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(expressInstance))
    : await NestFactory.create<NestExpressApplication>(AppModule)
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

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NEAGOLD API')
      .setDescription('Plataforma de identidad digital y trazabilidad de joyería')
      .setVersion('0.3.0')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api/docs', app, document)
  }

  Logger.log('NEAGOLD API inicializada', 'Bootstrap')
  return app
}