import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { IdentityModule } from '../identity/identity.module';
import { AuthService } from './application/auth.service';
import { AuthSecurityLogger } from './application/auth-security.logger';
import { OtpService } from './application/otp.service';
import { SessionService } from './application/session.service';
import { OTP_SENDER } from './domain/ports/otp-sender.port';
import { OTP_STORE } from './domain/ports/otp-store.port';
import { ConsoleOtpSender } from './infrastructure/otp/console-otp.sender';
import { DisabledOtpSender } from './infrastructure/otp/disabled-otp.sender';
import { InfobipOtpSender } from './infrastructure/otp/infobip-otp.sender';
import { TestOtpSender } from './infrastructure/otp/test-otp.sender';
import { RedisOtpStore } from './infrastructure/redis/redis-otp.store';
import { SessionAudienceStore } from './infrastructure/session-audience.store';
import { TokenService } from './infrastructure/token/token.service';
import { AuthController } from './presentation/http/auth.controller';
import { AuthGuard } from './presentation/http/guards/auth.guard';

function otpSenderFactory(config: ConfigService) {
  const transport = config.get<string>('auth.otpTransport', 'disabled');
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  if (
    nodeEnv === 'production' &&
    (transport === 'console' || transport === 'test')
  ) {
    throw new Error(`OTP_TRANSPORT=${transport} is forbidden in production`);
  }
  if (transport === 'console') {
    return new ConsoleOtpSender();
  }
  if (transport === 'test') {
    return new TestOtpSender();
  }
  if (transport === 'infobip') {
    return new InfobipOtpSender(config);
  }
  if (transport === 'disabled') {
    return new DisabledOtpSender();
  }
  throw new Error(`Unknown OTP_TRANSPORT=${transport}`);
}

@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    AuthSecurityLogger,
    TokenService,
    SessionAudienceStore,
    OtpService,
    SessionService,
    AuthService,
    RedisOtpStore,
    { provide: OTP_STORE, useExisting: RedisOtpStore },
    {
      provide: OTP_SENDER,
      useFactory: (config: ConfigService, testSender: TestOtpSender) => {
        const transport = config.get<string>('auth.otpTransport', 'disabled');
        if (transport === 'test') {
          return testSender;
        }
        return otpSenderFactory(config);
      },
      inject: [ConfigService, TestOtpSender],
    },
    TestOtpSender,
    AuthGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    AuthService,
    SessionService,
    TokenService,
    AuthSecurityLogger,
    OTP_SENDER,
    TestOtpSender,
  ],
})
export class AuthModule {}
