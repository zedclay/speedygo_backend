import { ConfigService } from '@nestjs/config';
import { AUTH_ERROR_CODES } from '../domain/auth.errors';
import { TokenService } from '../infrastructure/token/token.service';
import { AuthSecurityLogger } from './auth-security.logger';
import { AuthService } from './auth.service';

describe('AuthService account resolution', () => {
  const tokens = new TokenService({
    get: (key: string, fallback?: unknown) =>
      key === 'auth.jwtAccessSecret'
        ? 'unit-jwt-access-secret-32-chars!!'
        : key === 'auth.jwtAccessTtlSeconds'
          ? 900
          : key === 'auth.sessionTtlDays'
            ? 30
            : fallback,
  } as ConfigService);

  function build(
    existing: { id: string; status: string } | null,
    opts?: { enforce?: boolean },
  ) {
    const created = {
      id: 'new-account',
      status: 'ACTIVE',
      phone: '+213550123456',
      email: null,
    };
    const accounts = {
      findByIdentifier: () => Promise.resolve(existing),
      createMinimal: jest.fn(() => Promise.resolve(created)),
      createAuthenticatedSession: jest.fn((input: { sessionId: string }) =>
        Promise.resolve({
          sessionId: input.sessionId,
          deviceId: 'dev',
        }),
      ),
      findById: () => Promise.resolve(existing ?? created),
      profileFlags: () =>
        Promise.resolve({
          hasCustomerProfile: false,
          hasDriverProfile: false,
          hasAdminProfile: false,
          hasMerchantMembership: false,
        }),
    };
    const otp = {
      consume: jest.fn(() => Promise.resolve('+213550123456')),
      request: jest.fn(() => Promise.resolve()),
    };
    const bind = jest.fn(() => Promise.resolve());
    const service = new AuthService(
      otp as never,
      {} as never,
      accounts as never,
      tokens,
      {
        get: (_k: string, fb?: unknown) => fb ?? 30,
      } as ConfigService,
      new AuthSecurityLogger(),
      {
        enforce: () => opts?.enforce === true,
        bind,
        read: jest.fn(() => Promise.resolve(null)),
      } as never,
    );
    return { service, accounts, bind, otp };
  }

  const verifyInput = {
    channel: 'PHONE' as const,
    identifier: '0550123456',
    purpose: 'AUTHENTICATE' as const,
    code: '123456',
    device: { platform: 'ios' as const, appVersion: '1.0.0' },
    ip: '127.0.0.1',
  };

  it('creates a minimal Account on first verify', async () => {
    const { service, accounts } = build(null);
    const tokensPair = await service.verifyOtp(verifyInput);
    expect(accounts.createMinimal).toHaveBeenCalled();
    expect(tokensPair.accessToken).toBeTruthy();
    expect(tokensPair.refreshToken).toContain('.');
  });

  it('signs in an existing active account without creating another', async () => {
    const { service, accounts } = build({
      id: 'existing',
      status: 'ACTIVE',
    });
    await service.verifyOtp(verifyInput);
    expect(accounts.createMinimal).not.toHaveBeenCalled();
  });

  it('rejects suspended accounts', async () => {
    const { service } = build({ id: 's', status: 'SUSPENDED' });
    await expect(service.verifyOtp(verifyInput)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
    });
  });

  it('rejects disabled accounts', async () => {
    const { service } = build({ id: 'd', status: 'DISABLED' });
    await expect(service.verifyOtp(verifyInput)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_ACCOUNT_DISABLED,
    });
  });

  it('requires a requested audience when enforcement is on', async () => {
    const { service, otp } = build(null, { enforce: true });
    await expect(
      service.requestOtp({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        ip: '127.0.0.1',
      }),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_APP_AUDIENCE_REQUIRED,
    });
    expect(otp.request).not.toHaveBeenCalled();
  });

  it('binds session audience on verify without creating profiles', async () => {
    const { service, accounts, bind } = build(null);
    const pair = await service.verifyOtp({
      ...verifyInput,
      audience: 'CUSTOMER',
    });
    expect(bind).toHaveBeenCalled();
    expect(accounts.createMinimal).toHaveBeenCalled();
    const claims = tokens.verifyAccessToken(pair.accessToken);
    expect(claims.aud).toBe('CUSTOMER');
  });
});
