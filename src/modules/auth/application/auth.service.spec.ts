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

  function build(existing: { id: string; status: string } | null) {
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
      consume: () => Promise.resolve('+213550123456'),
    };
    const service = new AuthService(
      otp as never,
      {} as never,
      accounts as never,
      tokens,
      {
        get: (_k: string, fb?: unknown) => fb ?? 30,
      } as ConfigService,
      new AuthSecurityLogger(),
    );
    return { service, accounts };
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
});
