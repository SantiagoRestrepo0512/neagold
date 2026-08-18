import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import type { EnvConfig } from '../config/env.validation'
import { MfaModule } from '../mfa/mfa.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CookieService } from './cookies.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get('jwtAccessSecret', { infer: true }),
        signOptions: { expiresIn: config.get('jwtAccessTtlSeconds', { infer: true }) }
      })
    }),
    MfaModule
  ],
  controllers: [AuthController],
  providers: [AuthService, CookieService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, CookieService, JwtAuthGuard]
})
export class AuthModule {}