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
      listSessions: jest.fn(() =>
        Promise.resolve([
          {
            id: sessionId,
            accountId,
            refreshTokenHash: currentHash,
            deviceId: null,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            revokedAt: session.revokedAt ?? null,
            createdAt: new Date().toISOString(),
          },
        ]),
      ),
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

type FakeSession = {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  deviceId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

function cacheKeyFor(id: string): string {
  return `auth:test:sess:${id}`;
}

function serviceWithSessions(rows: FakeSession[]) {
  const sessions = rows.map((row) => ({ ...row }));
  const accounts = {
    findSession: (id: string) =>
      Promise.resolve(sessions.find((row) => row.id === id) ?? null),
    findById: (id: string) =>
      Promise.resolve({
        id,
        phone: null,
        email: null,
        status: 'ACTIVE',
      }),
    listSessions: (accountId: string) =>
      Promise.resolve(sessions.filter((row) => row.accountId === accountId)),
    revokeAllSessions: (accountId: string) => {
      const now = new Date().toISOString();
      const ids: string[] = [];
      for (const row of sessions) {
        if (row.accountId === accountId && !row.revokedAt) {
          row.revokedAt = now;
          ids.push(row.id);
        }
      }
      return Promise.resolve(ids);
    },
    revokeSession: (id: string) => {
      const row = sessions.find((item) => item.id === id);
      if (row && !row.revokedAt) {
        row.revokedAt = new Date().toISOString();
      }
      return Promise.resolve();
    },
    rotateRefreshHash: (input: {
      sessionId: string;
      expectedHash: string;
      nextHash: string;
    }) => {
      const row = sessions.find((item) => item.id === input.sessionId);
      if (
        !row ||
        row.revokedAt ||
        row.refreshTokenHash !== input.expectedHash
      ) {
        return Promise.resolve(false);
      }
      row.refreshTokenHash = input.nextHash;
      return Promise.resolve(true);
    },
  };
  const service = new SessionService(
    accounts as never,
    new TokenService(config()),
    redis as never,
    config(),
    new AuthSecurityLogger(),
  );
  return { service, sessions };
}

describe('SessionService.revokeAllSessionsForAccount', () => {
  const tokens = new TokenService(config());
  const target = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
  const s1 = '11111111-1111-7111-8111-111111111111';
  const s2 = '22222222-2222-7222-8222-222222222222';
  const sOther = '33333333-3333-7333-8333-333333333333';

  beforeEach(() => redisStore.clear());

  function seed(): FakeSession[] {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createdAt = new Date().toISOString();
    return [
      {
        id: s1,
        accountId: target,
        refreshTokenHash: tokens.issueRefreshToken(s1).hash,
        deviceId: null,
        expiresAt,
        revokedAt: null,
        createdAt,
      },
      {
        id: s2,
        accountId: target,
        refreshTokenHash: tokens.issueRefreshToken(s2).hash,
        deviceId: null,
        expiresAt,
        revokedAt: null,
        createdAt,
      },
      {
        id: sOther,
        accountId: other,
        refreshTokenHash: tokens.issueRefreshToken(sOther).hash,
        deviceId: null,
        expiresAt,
        revokedAt: null,
        createdAt,
      },
    ];
  }

  it('revokes every target session, drops their cache, and leaves other accounts', async () => {
    const { service, sessions } = serviceWithSessions(seed());
    redisStore.set(cacheKeyFor(s1), '{"status":"ACTIVE"}');
    redisStore.set(cacheKeyFor(s2), '{"status":"ACTIVE"}');
    redisStore.set(cacheKeyFor(sOther), '{"status":"ACTIVE"}');

    await service.revokeAllSessionsForAccount(target);

    expect(sessions.find((row) => row.id === s1)?.revokedAt).toBeTruthy();
    expect(sessions.find((row) => row.id === s2)?.revokedAt).toBeTruthy();
    expect(sessions.find((row) => row.id === sOther)?.revokedAt).toBeNull();
    expect(redisStore.has(cacheKeyFor(s1))).toBe(false);
    expect(redisStore.has(cacheKeyFor(s2))).toBe(false);
    expect(redisStore.has(cacheKeyFor(sOther))).toBe(true);
  });

  it('is safe to call repeatedly', async () => {
    const { service, sessions } = serviceWithSessions(seed());
    await service.revokeAllSessionsForAccount(target);
    await expect(
      service.revokeAllSessionsForAccount(target),
    ).resolves.toBeDefined();
    expect(
      sessions
        .filter((row) => row.accountId === target)
        .every((row) => row.revokedAt),
    ).toBe(true);
    expect(sessions.find((row) => row.id === sOther)?.revokedAt).toBeNull();
  });
});

describe('SessionService concurrent refresh', () => {
  const tokenService = new TokenService(config());
  const sessionId = '22222222-2222-7222-8222-222222222222';
  const accountId = '33333333-3333-7333-8333-333333333333';

  beforeEach(() => redisStore.clear());

  it('revokes the session when the same refresh token is used concurrently', async () => {
    const issued = tokenService.issueRefreshToken(sessionId);
    const { service, sessions } = serviceWithSessions([
      {
        id: sessionId,
        accountId,
        refreshTokenHash: issued.hash,
        deviceId: null,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        revokedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const results = await Promise.allSettled([
      service.refresh(issued.token),
      service.refresh(issued.token),
    ]);
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(succeeded.length).toBeLessThanOrEqual(1);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0]?.revokedAt).toBeTruthy();

    await expect(service.refresh(issued.token)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_SESSION_REVOKED,
    });
    if (succeeded[0]?.status === 'fulfilled') {
      await expect(
        service.refresh(succeeded[0].value.refreshToken),
      ).rejects.toMatchObject({
        code: AUTH_ERROR_CODES.AUTH_SESSION_REVOKED,
      });
    }
  });
});
