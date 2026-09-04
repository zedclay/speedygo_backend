import { AUTH_ERROR_CODES } from '../../auth/domain/auth.errors';
import { AuthSecurityLogger } from '../../auth/application/auth-security.logger';
import { PermissionsGuard } from '../../authorization/permissions.guard';
import { AdminProfileService } from '../application/admin-profile.service';
import { ADMIN_ERROR_CODES } from './admin.errors';
import { ADMIN_PERMISSIONS } from './admin-permissions';

describe('Admin authorization policy (permission-first)', () => {
  const security = new AuthSecurityLogger();

  function permissionsGuard(accountCodes: string[], required: string[]) {
    return new PermissionsGuard(
      {
        getAllAndOverride: () => required,
      } as never,
      {
        codesForAccount: () => Promise.resolve(accountCodes),
      } as never,
      security,
    );
  }

  function httpCtx(accountId = 'acct') {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          principal: { accountId, sessionId: 'sess' },
        }),
      }),
    } as never;
  }

  it('denies Role.name SUPER_ADMIN when required permission codes are absent', async () => {
    // Role.name is non-authoritative — only Permission.code membership matters.
    const guard = permissionsGuard([], [ADMIN_PERMISSIONS.MERCHANTS_VERIFY]);
    await expect(guard.canActivate(httpCtx())).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_FORBIDDEN,
    });
  });

  it('allows an arbitrary Role.name when required permission codes are present', async () => {
    const guard = permissionsGuard(
      [ADMIN_PERMISSIONS.MERCHANTS_VERIFY],
      [ADMIN_PERMISSIONS.MERCHANTS_VERIFY],
    );
    await expect(guard.canActivate(httpCtx())).resolves.toBe(true);
  });

  it('AdminProfileService throws ADMIN_ROLE_INACTIVE when Role.active is false', async () => {
    const permissions = { codesForAccount: jest.fn() };
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AdminProfile: {
              where: () => ({
                first: () =>
                  Promise.resolve({
                    id: 'a1',
                    roleId: 'r1',
                    displayName: 'Ops',
                  }),
              }),
            },
            Role: {
              where: () => ({
                first: () =>
                  Promise.resolve({
                    id: 'r1',
                    name: 'SUPER_ADMIN',
                    active: false,
                  }),
              }),
            },
          },
        },
      }),
    };
    const service = new AdminProfileService(
      prisma as never,
      permissions as never,
    );
    await expect(
      service.resolveCurrentAdmin('acct', 'sess'),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_ROLE_INACTIVE,
      httpStatus: 403,
    });
    expect(permissions.codesForAccount).not.toHaveBeenCalled();
  });

  it('finance and verification permission codes are independent sets', () => {
    const ledger = ADMIN_PERMISSIONS.LEDGER_READ;
    const refunds = ADMIN_PERMISSIONS.REFUNDS_MANAGE;
    const settlements = ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE;
    const cod = ADMIN_PERMISSIONS.COD_REMITTANCE_CONFIRM;
    const merchantsVerify = ADMIN_PERMISSIONS.MERCHANTS_VERIFY;
    const driversVerify = ADMIN_PERMISSIONS.DRIVERS_VERIFY;

    expect(ledger).not.toBe(refunds);
    expect(ledger).not.toBe(settlements);
    expect(ledger).not.toBe(cod);
    expect(ledger).not.toBe(merchantsVerify);
    expect(refunds).not.toBe(settlements);
    expect(refunds).not.toBe(cod);
    expect(refunds).not.toBe(merchantsVerify);
    expect(settlements).not.toBe(cod);
    expect(merchantsVerify).not.toBe(driversVerify);

    const financeMutations = new Set([refunds, settlements, cod]);
    expect(financeMutations.has(ledger)).toBe(false);
    expect(financeMutations.has(merchantsVerify)).toBe(false);
    expect(financeMutations.has(ADMIN_PERMISSIONS.ORDERS_READ)).toBe(false);
    expect(financeMutations.has(ADMIN_PERMISSIONS.PAYMENTS_READ)).toBe(false);
  });
});
