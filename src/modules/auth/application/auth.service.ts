import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { AccountRepository } from '../../identity/account.repository';
import { authAccountBlocked, authInvalidToken } from '../domain/auth.errors';
import type {
  AuthChannel,
  DeviceMetadata,
  OtpPurpose,
  TokenPair,
} from '../domain/auth.types';
import { TokenService } from '../infrastructure/token/token.service';
import { AuthSecurityLogger } from './auth-security.logger';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountRepository,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly security: AuthSecurityLogger,
  ) {}

  async requestOtp(input: {
    channel: AuthChannel;
    identifier: string;
    purpose: OtpPurpose;
    ip: string;
  }): Promise<{ accepted: true }> {
    await this.otp.request(input);
    return { accepted: true };
  }

  async verifyOtp(input: {
    channel: AuthChannel;
    identifier: string;
    purpose: OtpPurpose;
    code: string;
    device: DeviceMetadata;
    ip: string;
  }): Promise<TokenPair> {
    const identifier = await this.otp.consume(input);
    const existing = await this.accounts.findByIdentifier(
      input.channel,
      identifier,
    );
    const account =
      existing ??
      (await this.accounts.createMinimal(input.channel, identifier));
    if (account.status === 'SUSPENDED' || account.status === 'DISABLED') {
      this.security.emit('authentication_blocked_account_status', {
        accountId: account.id,
        status: account.status,
      });
      throw authAccountBlocked(account.status);
    }

    const sessionId = createUuidV7();
    const issued = this.tokens.issueRefreshToken(sessionId);
    const days = this.config.get<number>('auth.sessionTtlDays', 30);
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.accounts.createAuthenticatedSession({
      sessionId,
      accountId: account.id,
      device: input.device,
      refreshTokenHash: issued.hash,
      ipAddress: input.ip === 'unknown' ? null : input.ip,
      expiresAt,
    });
    this.security.emit('session_created', {
      accountId: account.id,
      sessionId,
    });
    return {
      accessToken: this.tokens.signAccessToken(account.id, sessionId),
      refreshToken: issued.token,
      expiresIn: this.tokens.accessTtlSeconds(),
      tokenType: 'Bearer',
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const rotated = await this.sessions.refresh(refreshToken);
    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: rotated.expiresIn,
      tokenType: 'Bearer',
    };
  }

  async me(accountId: string) {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw authInvalidToken();
    }
    const profiles = await this.accounts.profileFlags(accountId);
    return {
      account: {
        id: account.id,
        phone: account.phone,
        email: account.email,
        status: account.status,
      },
      profiles,
    };
  }
}
