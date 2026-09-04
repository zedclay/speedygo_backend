import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { ADMIN_ERROR_CODES } from '../../domain/admin.errors';

describe('AdminGuard', () => {
  const profiles = {
    resolveCurrentAdmin: jest.fn(),
  };

  function ctx(principal?: { accountId: string; sessionId: string }) {
    const request: Record<string, unknown> = { principal };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      request,
    } as unknown as ExecutionContext & { request: Record<string, unknown> };
  }

  beforeEach(() => {
    profiles.resolveCurrentAdmin.mockReset();
  });

  it('rejects missing principal', async () => {
    const guard = new AdminGuard(profiles as never);
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
  });

  it('attaches CurrentAdminContext on success', async () => {
    const admin = {
      adminProfileId: 'a1',
      accountId: 'acct',
      sessionId: 'sess',
      displayName: 'Ops',
      roleId: 'r1',
      roleName: 'ops',
      permissions: ['merchants.read'],
    };
    profiles.resolveCurrentAdmin.mockResolvedValue(admin);
    const guard = new AdminGuard(profiles as never);
    const context = ctx({ accountId: 'acct', sessionId: 'sess' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((context as { request: { admin?: unknown } }).request.admin).toEqual(
      admin,
    );
  });

  it('propagates ADMIN_PROFILE_REQUIRED', async () => {
    profiles.resolveCurrentAdmin.mockRejectedValue({
      code: ADMIN_ERROR_CODES.ADMIN_PROFILE_REQUIRED,
      httpStatus: 403,
    });
    const guard = new AdminGuard(profiles as never);
    await expect(
      guard.canActivate(ctx({ accountId: 'acct', sessionId: 'sess' })),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_PROFILE_REQUIRED,
    });
  });
});
