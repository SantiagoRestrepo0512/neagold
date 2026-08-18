import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { validateEnv, type EnvConfig } from './config/env.validation'
import { PrismaModule } from './prisma/prisma.module'
import { AuditModule } from './audit/audit.module'
import { SecurityModule } from './security/security.module'
import { RolesModule } from './roles/roles.module'
import { AuthModule } from './auth/auth.module'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { UsersModule } from './users/users.module'
import { HealthModule } from './health/health.module'
import { ProductsModule } from './products/products.module'
import { PiecesModule } from './pieces/pieces.module'
import { SalesModule } from './sales/sales.module'
import { ClaimsModule } from './claims/claims.module'
import { TransfersModule } from './transfers/transfers.module'
import { VerificationModule } from './verification/verification.module'
import { IncidentsModule } from './incidents/incidents.module'
import { EventsModule } from './events/events.module'
import { EmailModule } from './email/email.module'
import { NotificationsModule } from './notifications/notifications.module'
import { WebhooksModule } from './webhooks/webhooks.module'
import { CertificatesModule } from './certificates/certificates.module'
import { ServicesModule } from './services/services.module'
import { PermissionsGuard } from './roles/permissions.guard'
import { CsrfGuard } from './security/csrf.guard'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        throttlers: [
          {
            ttl: config.get('throttleTtlSeconds', { infer: true }) * 1000,
            limit: config.get('throttleLimit', { infer: true })
          },
          {
            name: 'login',
            ttl: config.get('loginThrottleTtlMs', { infer: true }),
            limit: config.get('loginThrottleLimit', { infer: true }),
            // El límite de login aplica solo al endpoint de login (15/min en
            // producción por defecto; configurable por entorno para tests).
            skipIf: (context) => {
              const request = context.switchToHttp().getRequest<{ url?: string }>()
              return typeof request.url !== 'string' || !request.url.includes('/auth/login')
            }
          }
        ]
      })
    }),
    PrismaModule,
    AuditModule,
    SecurityModule,
    EmailModule,
    RolesModule,
    AuthModule,
    UsersModule,
    HealthModule,
    ProductsModule,
    PiecesModule,
    SalesModule,
    ClaimsModule,
    TransfersModule,
    VerificationModule,
    IncidentsModule,
    EventsModule,
    NotificationsModule,
    WebhooksModule,
    CertificatesModule,
    ServicesModule
  ],
  providers: [
    // Orden de ejecución: CSRF -> Throttler -> JWT -> Permissions
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL })
  }
}