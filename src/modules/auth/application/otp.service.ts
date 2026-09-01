import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { identifierHash, normalizeIdentifier } from '../domain/identity';
import {
  authInvalidOtp,
  authOtpAttemptsExceeded,
  authOtpExpired,
  authRateLimited,
} from '../domain/auth.errors';
import {
  OTP_SENDER,
  type OtpSenderPort,
} from '../domain/ports/otp-sender.port';
import { OTP_STORE, type OtpStorePort } from '../domain/ports/otp-store.port';
import type { AuthChannel, OtpPurpose } from '../domain/auth.types';
import { generateNumericOtp, hmacOtp } from '../infrastructure/otp/otp-hash';
import { AuthSecurityLogger } from './auth-security.logger';

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_STORE) private readonly store: OtpStorePort,
    @Inject(OTP_SENDER) private readonly sender: OtpSenderPort,
    private readonly config: ConfigService,
    private readonly security: AuthSecurityLogger,
  ) {}

  private hmacSecret(): string {
    return this.config.get<string>('auth.otpHmacSecret', '');
  }

  normalize(channel: AuthChannel, identifier: string): string {
    return normalizeIdentifier(
      channel,
      identifier,
      this.config.get<string>('auth.defaultCountry', 'DZ'),
    );
  }

  async request(input: {
    channel: AuthChannel;
    identifier: string;
    purpose: OtpPurpose;
    ip: string;
  }): Promise<void> {
    const identifier = this.normalize(input.channel, input.identifier);
    const hash = identifierHash(identifier);
    const ipHash = createHash('sha256').update(input.ip, 'utf8').digest('hex');

    const maxId = this.config.get<number>('auth.otpMaxRequestsPerHour', 5);
    const maxIp = this.config.get<number>(
      'auth.otpMaxRequestsPerIpPerHour',
      20,
    );
    const hourly = await this.store.incrementHourly(
      input.purpose,
      input.channel,
      hash,
    );
    const ipHourly = await this.store.incrementIpHourly(ipHash);
    if (hourly > maxId || ipHourly > maxIp) {
      this.security.emit('otp_requested', {
        channel: input.channel,
        identifierHash: hash,
        rateLimited: true,
      });
      throw authRateLimited();
    }

    if (await this.store.isCoolingDown(input.purpose, input.channel, hash)) {
      throw authRateLimited();
    }

    const ttl = this.config.get<number>('auth.otpTtlSeconds', 300);
    const cooldown = this.config.get<number>(
      'auth.otpResendCooldownSeconds',
      60,
    );
    const code = generateNumericOtp(6);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const codeHash = hmacOtp({
      secret: this.hmacSecret(),
      identifier,
      purpose: input.purpose,
      channel: input.channel,
      code,
    });

    await this.store.saveChallenge(
      input.purpose,
      input.channel,
      hash,
      {
        codeHash,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        attemptCount: 0,
        requestCount: hourly,
        channel: input.channel,
        purpose: input.purpose,
      },
      ttl,
    );
    await this.store.markCooldown(input.purpose, input.channel, hash, cooldown);
    await this.sender.send({
      channel: input.channel,
      identifier,
      purpose: input.purpose,
      code,
    });
    this.security.emit('otp_requested', {
      channel: input.channel,
      identifierHash: hash,
      purpose: input.purpose,
    });
  }

  async consume(input: {
    channel: AuthChannel;
    identifier: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<string> {
    const identifier = this.normalize(input.channel, input.identifier);
    const hash = identifierHash(identifier);
    const codeHash = hmacOtp({
      secret: this.hmacSecret(),
      identifier,
      purpose: input.purpose,
      channel: input.channel,
      code: input.code,
    });
    const maxAttempts = this.config.get<number>('auth.otpMaxAttempts', 5);
    const result = await this.store.consumeIfMatch(
      input.purpose,
      input.channel,
      hash,
      codeHash,
      maxAttempts,
    );
    if (result.outcome === 'ok') {
      this.security.emit('otp_verified', {
        channel: input.channel,
        identifierHash: hash,
        purpose: input.purpose,
      });
      return identifier;
    }
    this.security.emit('otp_verification_failed', {
      channel: input.channel,
      identifierHash: hash,
      purpose: input.purpose,
    });
    if (result.outcome === 'missing') {
      throw authOtpExpired();
    }
    if (result.attemptsExceeded) {
      throw authOtpAttemptsExceeded();
    }
    throw authInvalidOtp();
  }
}
