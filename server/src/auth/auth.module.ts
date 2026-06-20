import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // UsersModule re-exports MongooseModule (User model) + UsersService.
    UsersModule,
    // ReferralModule provides ReferralService (code-gen + attribution).
    ReferralModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        // Required + validated at bootstrap (see config/env.validation.ts).
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // plain config string → ms StringValue union the jwt types expect
          expiresIn: (config.get<string>('JWT_ACCESS_TTL') ??
            '15m') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
