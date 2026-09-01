import { AUTH_ERROR_CODES } from '../auth/domain/auth.errors';
import { AuthSecurityLogger } from '../auth/application/auth-security.logger';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const security = new AuthSecurityLogger();

  function guard(codes: string[], required: string[]) {
    const reflector = {
      getAllAndOverride: () => required,
    };
    const permissions = {
      codesForAccount: () => Promise.resolve(codes),
    };
    return new PermissionsGuard(
      reflector as never,
      permissions as never,
      security,
    );
  }

  it('grants when all required permissions are present', async () => {
    const g = guard(['orders.read'], ['orders.read']);
    await expect(
      g.canActivate({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            principal: { accountId: 'a', sessionId: 's' },
          }),
        }),
      } as never),
    ).resolves.toBe(true);
  });

  it('denies when a permission is missing', async () => {
    const g = guard([], ['orders.read']);
    await expect(
      g.canActivate({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            principal: { accountId: 'a', sessionId: 's' },
          }),
        }),
      } as never),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_FORBIDDEN });
  });

  it('denies when the principal is missing', async () => {
    const g = guard(['orders.read'], ['orders.read']);
    await expect(
      g.canActivate({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
      } as never),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_INVALID_TOKEN });
  });
});
