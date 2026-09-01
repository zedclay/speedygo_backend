import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import {
  authAccountBlocked,
  authInvalidToken,
  authSessionExpired,
  authSessionRevoked,
} from '../domain/auth.errors';
import type { AuthenticatedPrincipal } from '../domain/auth.types';
import { AccountRepository } from '../../identity/account.repository';
import { TokenService } from '../infrastructure/token/token.service';
import { AuthSecurityLogger } from './auth-security.logger';
import { timingSafeEqualText } from '../../../common/utils/timing-safe';

export type SessionView = {
  id: string;
  deviceId: string | null;
  platform: string | null;
  deviceName: string | null;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  currentSession: boolean;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly security: AuthSecurityLogger,
  ) {}

  private cacheKey(sessionId: string): string {
    const prefix = this.config.get<string>('auth.redisKeyPrefix', 'auth:');
    return `${prefix}sess:${sessionId}`;
  }

  private async dropCache(sessionId: string): Promise<void> {
    await this.redis.getClient().del(this.cacheKey(sessionId));
  }

  private assertUsableAccount(status: string): void {
    if (status === 'SUSPENDED' || status === 'DISABLED') {
      this.security.emit('authentication_blocked_account_status', { status });
      throw authAccountBlocked(status);
    }
    if (status !== 'ACTIVE') {
      throw authAccountBlocked('DISABLED');
    }
  }

  async assertPrincipal(
    accountId: string,
    sessionId: string,
  ): Promise<AuthenticatedPrincipal> {
    const ttl = this.config.get<number>('auth.sessionCacheTtlSeconds', 15);
    const cached = await this.redis.getClient().get(this.cacheKey(sessionId));
    if (cached) {
      const snap = JSON.parse(cached) as {
        accountId: string;
        status: string;
        revokedAt: string | null;
        expiresAt: string;
      };
      if (snap.accountId !== accountId) {
        throw authInvalidToken();
      }
      if (snap.revokedAt) {
        throw authSessionRevoked();
      }
      if (Date.parse(snap.expiresAt) <= Date.now()) {
        throw authSessionExpired();
      }
      this.assertUsableAccount(snap.status);
      return { accountId, sessionId };
    }

    const session = await this.accounts.findSession(sessionId);
    if (!session || session.accountId !== accountId) {
      throw authInvalidToken();
    }
    if (session.revokedAt) {
      throw authSessionRevoked();
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw authSessionExpired();
    }
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw authInvalidToken();
    }
    this.assertUsableAccount(account.status);
    await this.redis.getClient().set(
      this.cacheKey(sessionId),
      JSON.stringify({
        accountId,
        status: account.status,
        revokedAt: session.revokedAt,
        expiresAt: session.expiresAt,
      }),
      'EX',
      ttl,
    );
    return { accountId, sessionId };
  }

  async refresh(refreshToken: string) {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.accounts.findSession(parsed.sessionId);
    if (!session) {
      throw authInvalidToken();
    }
    if (session.revokedAt) {
      throw authSessionRevoked();
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw authSessionExpired();
    }
    if (!timingSafeEqualText(session.refreshTokenHash, presentedHash)) {
      await this.accounts.revokeSession(session.id);
      await this.dropCache(session.id);
      this.security.emit('refresh_reuse_detected', {
        accountId: session.accountId,
        sessionId: session.id,
      });
      throw authInvalidToken();
    }

    const account = await this.accounts.findById(session.accountId);
    if (!account) {
      throw authInvalidToken();
    }
    this.assertUsableAccount(account.status);

    const next = this.tokens.issueRefreshToken(session.id);
    const rotated = await this.accounts.rotateRefreshHash({
      sessionId: session.id,
      expectedHash: presentedHash,
      nextHash: next.hash,
    });
    if (!rotated) {
      await this.accounts.revokeSession(session.id);
      await this.dropCache(session.id);
      this.security.emit('refresh_reuse_detected', {
        accountId: session.accountId,
        sessionId: session.id,
      });
      throw authInvalidToken();
    }

    await this.dropCache(session.id);
    this.security.emit('session_refreshed', {
      accountId: session.accountId,
      sessionId: session.id,
    });
    return {
      accountId: session.accountId,
      sessionId: session.id,
      refreshToken: next.token,
      accessToken: this.tokens.signAccessToken(session.accountId, session.id),
      expiresIn: this.tokens.accessTtlSeconds(),
    };
  }

  async logout(sessionId: string, accountId: string): Promise<void> {
    const session = await this.accounts.findSession(sessionId);
    if (!session || session.accountId !== accountId) {
      throw authInvalidToken();
    }
    await this.accounts.revokeSession(sessionId);
    await this.dropCache(sessionId);
    this.security.emit('session_revoked', { accountId, sessionId });
  }

  async logoutAll(accountId: string): Promise<void> {
    const sessionIds = await this.accounts.revokeAllSessions(accountId);
    await Promise.all(sessionIds.map((id) => this.dropCache(id)));
    this.security.emit('all_sessions_revoked', { accountId });
  }

  async listOwned(
    accountId: string,
    currentSessionId: string,
  ): Promise<SessionView[]> {
    const rows = await this.accounts.listSessions(accountId);
    const views: SessionView[] = [];
    for (const row of rows) {
      const device = row.deviceId
        ? await this.accounts.findDevice(row.deviceId)
        : null;
      views.push({
        id: row.id,
        deviceId: row.deviceId,
        platform: device?.platform ?? null,
        deviceName: device?.deviceName ?? null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revoked: Boolean(row.revokedAt),
        currentSession: row.id === currentSessionId,
      });
    }
    return views;
  }

  async revokeOwned(accountId: string, sessionId: string): Promise<void> {
    const session = await this.accounts.findSession(sessionId);
    if (!session || session.accountId !== accountId) {
      throw authInvalidToken();
    }
    await this.accounts.revokeSession(sessionId);
    await this.dropCache(sessionId);
    this.security.emit('session_revoked', { accountId, sessionId });
  }
}
