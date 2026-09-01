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

describe('SessionService', () => {
  const tokens = new TokenService(config());
  const sessionId = '22222222-2222-7222-8222-222222222222';
  const accountId = '33333333-3333-7333-8333-333333333333';

  beforeEach(() => redisStore.clear());

  function build(session: {
    refreshTokenHash: string;
    revokedAt?: string | null;
    expiresAt?: string;
    status?: string;
    rotateOk?: boolean;
  }) {
    let currentHash = session.refreshTokenHash;
    const accounts = {
      findSession: () =>
        Promise.resolve({
          id: sessionId,
          accountId,
          refreshTokenHash: currentHash,
          deviceId: null,
          expiresAt:
            session.expiresAt ??
            new Date(Date.now() + 86_400_000).toISOString(),
          revokedAt: session.revokedAt ?? null,
          createdAt: new Date().toISOString(),
        }),
      findById: () =>
        Promise.resolve({
          id: accountId,
          phone: '+213550123456',
          email: null,
          status: session.status ?? 'ACTIVE',
        }),
      rotateRefreshHash: (input: { nextHash: string }) => {
        if (session.rotateOk === false) {
          return Promise.resolve(false);
        }
        currentHash = input.nextHash;
        return Promise.resolve(true);
      },
      revokeSession: jest.fn(() => Promise.resolve(undefined)),
      revokeAllSessions: jest.fn(() => Promise.resolve([sessionId])),
    };
    const service = new SessionService(
      accounts as never,
      tokens,
      redis as never,
      config(),
      new AuthSecurityLogger(),
    );
    return { service, accounts };
  }

  it('rotates a valid refresh token and rejects the old one', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const { service } = build({ refreshTokenHash: issued.hash });
    const first = await service.refresh(issued.token);
    expect(first.accessToken).toBeTruthy();
    expect(first.refreshToken).not.toBe(issued.token);
    await expect(service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_INVALID_TOKEN,
    });
  });

  it('revokes the session on hash mismatch (reuse)', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const other = tokens.issueRefreshToken(sessionId);
    const { service, accounts } = build({ refreshTokenHash: issued.hash });
    await expect(service.refresh(other.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_INVALID_TOKEN,
    });
    expect(accounts.revokeSession).toHaveBeenCalledWith(sessionId);
  });

  it('rejects expired and revoked sessions', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const expired = build({
      refreshTokenHash: issued.hash,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(expired.service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_SESSION_EXPIRED,
    });
    const revoked = build({
      refreshTokenHash: issued.hash,
      revokedAt: new Date().toISOString(),
    });
    await expect(revoked.service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_SESSION_REVOKED,
    });
  });

  it('blocks suspended accounts', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const { service } = build({
      refreshTokenHash: issued.hash,
      status: 'SUSPENDED',
    });
    await expect(service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
    });
  });

  it('logout and logout-all revoke sessions', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const { service, accounts } = build({ refreshTokenHash: issued.hash });
    await service.logout(sessionId, accountId);
    expect(accounts.revokeSession).toHaveBeenCalledWith(sessionId);
    await service.logoutAll(accountId);
    expect(accounts.revokeAllSessions).toHaveBeenCalledWith(accountId);
  });

  it('treats a failed conditional rotate as reuse', async () => {
    const issued = tokens.issueRefreshToken(sessionId);
    const { service, accounts } = build({
      refreshTokenHash: issued.hash,
      rotateOk: false,
    });
    await expect(service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_INVALID_TOKEN,
    });
    expect(accounts.revokeSession).toHaveBeenCalled();
  });
});
