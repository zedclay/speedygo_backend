import { AdminProfileService } from './admin-profile.service';
import { ADMIN_ERROR_CODES } from '../domain/admin.errors';

describe('AdminProfileService', () => {
  const permissions = {
    codesForAccount: jest.fn(),
  };

  function buildPrisma(opts: {
    profile?: { id: string; roleId: string; displayName: string } | null;
    role?: { id: string; name: string; active: boolean } | null;
  }) {
    return {
      getDb: () => ({
        orm: {
          public: {
            AdminProfile: {
              where: () => ({
                first: () => Promise.resolve(opts.profile ?? null),
              }),
            },
            Role: {
              where: () => ({
                first: () => Promise.resolve(opts.role ?? null),
              }),
            },
          },
        },
      }),
    };
  }

  beforeEach(() => {
    permissions.codesForAccount.mockReset();
  });

  it('throws ADMIN_PROFILE_REQUIRED when profile is missing', async () => {
    const service = new AdminProfileService(
      buildPrisma({ profile: null }) as never,
      permissions as never,
    );
    await expect(
      service.resolveCurrentAdmin('acct', 'sess'),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_PROFILE_REQUIRED,
      httpStatus: 403,
    });
  });

  it('throws ADMIN_ROLE_INACTIVE when role.active is false', async () => {
    const service = new AdminProfileService(
      buildPrisma({
        profile: { id: 'a1', roleId: 'r1', displayName: 'Ops' },
        role: { id: 'r1', name: 'ops', active: false },
      }) as never,
      permissions as never,
    );
    await expect(
      service.resolveCurrentAdmin('acct', 'sess'),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_ROLE_INACTIVE,
      httpStatus: 403,
    });
  });

  it('returns CurrentAdminContext with permission codes', async () => {
    permissions.codesForAccount.mockResolvedValue(['merchants.read']);
    const service = new AdminProfileService(
      buildPrisma({
        profile: { id: 'a1', roleId: 'r1', displayName: 'Ops' },
        role: { id: 'r1', name: 'ops', active: true },
      }) as never,
      permissions as never,
    );
    await expect(service.resolveCurrentAdmin('acct', 'sess')).resolves.toEqual({
      adminProfileId: 'a1',
      accountId: 'acct',
      sessionId: 'sess',
      displayName: 'Ops',
      roleId: 'r1',
      roleName: 'ops',
      permissions: ['merchants.read'],
    });
  });
});
