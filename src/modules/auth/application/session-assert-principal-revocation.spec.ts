import { ConfigService } from '@nestjs/config';
import { AUTH_ERROR_CODES } from '../domain/auth.errors';
import { TokenService } from '../infrastructure/token/token.service';
import { AuthSecurityLogger } from './auth-security.logger';
import { SessionService } from './session.service';

const redisStore = new Map<string, string>();

const redis = {
  getClient: () => ({
    get: (key: string) => Promise.resolve(redisStore.get(key) ?? null),
    set: (key: string, value: string) => {
      redisStore.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key: string) => {
      redisStore.delete(key);
      return Promise.resolve(1);
    },
  }),
};

function config() {
  return {
    get: (key: string, fallback?: unknown) => {
      const map: Record<string, unknown> = {
        'auth.jwtAccessSecret': 'unit-jwt-access-secret-32-chars!!',
        'auth.jwtAccessTtlSeconds': 900,
        'auth.redisKeyPrefix': 'auth:test:',
        'auth.sessionCacheTtlSeconds': 15,
      };
      return map[key] ?? fallback;
    },
  } as ConfigService;
}

describe('SessionService.assertPrincipal revocation (P1-G)', () => {
  const sessionId = '22222222-2222-7222-8222-222222222222';
  const accountId = '33333333-3333-7333-8333-333333333333';
  const cacheKey = `auth:test:sess:${sessionId}`;

  beforeEach(() => redisStore.clear());

  function build(revokedAt: string | null) {
    const accounts = {
      findSession: () =>
        Promise.resolve({
          id: sessionId,
          accountId,
          refreshTokenHash: 'hash',
          deviceId: null,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          revokedAt,
          createdAt: new Date().toISOString(),
        }),
      findById: () =>
        Promise.resolve({
          id: accountId,
          phone: '+213550123456',
          email: null,
          status: 'ACTIVE',
        }),
    };
    const service = new SessionService(
      accounts as never,
      new TokenService(config()),
      redis as never,
      config(),
      new AuthSecurityLogger(),
    );
    return service;
  }

  it('rejects a DB-revoked session even when Redis has a warm ACTIVE snap', async () => {
    redisStore.set(cacheKey, JSON.stringify({ status: 'ACTIVE' }));
    const service = build(new Date().toISOString());

    await expect(
      service.assertPrincipal(accountId, sessionId),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_SESSION_REVOKED,
    });
    expect(redisStore.has(cacheKey)).toBe(false);
  });

  it('allows an active DB session regardless of Redis presence', async () => {
    redisStore.set(cacheKey, JSON.stringify({ status: 'ACTIVE' }));
    const service = build(null);
    await expect(
      service.assertPrincipal(accountId, sessionId),
    ).resolves.toEqual({ accountId, sessionId });
  });
});
