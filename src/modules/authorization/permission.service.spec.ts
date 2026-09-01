import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  const redis = {
    getClient: () => ({
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
    }),
  };

  it('returns no permissions when AdminProfile is missing', async () => {
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AdminProfile: {
              where: () => ({ first: () => Promise.resolve(null) }),
            },
          },
        },
      }),
    };
    const service = new PermissionService(
      prisma as never,
      redis as never,
      { get: (_k: string, fb?: unknown) => fb } as never,
    );
    await expect(service.codesForAccount('acct')).resolves.toEqual([]);
  });

  it('returns permission codes for an active admin role', async () => {
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AdminProfile: {
              where: () => ({
                first: () => Promise.resolve({ roleId: 'r1' }),
              }),
            },
            Role: {
              where: () => ({
                first: () => Promise.resolve({ id: 'r1', active: true }),
              }),
            },
            RolePermission: {
              where: () => ({
                all: () => Promise.resolve([{ permissionId: 'p1' }]),
              }),
            },
            Permission: {
              where: () => ({
                first: () => Promise.resolve({ id: 'p1', code: 'orders.read' }),
              }),
            },
          },
        },
      }),
    };
    const service = new PermissionService(
      prisma as never,
      redis as never,
      { get: (_k: string, fb?: unknown) => fb } as never,
    );
    await expect(service.codesForAccount('acct')).resolves.toEqual([
      'orders.read',
    ]);
  });

  it('returns no permissions when the role is inactive', async () => {
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AdminProfile: {
              where: () => ({
                first: () => Promise.resolve({ roleId: 'r1' }),
              }),
            },
            Role: {
              where: () => ({
                first: () => Promise.resolve({ id: 'r1', active: false }),
              }),
            },
          },
        },
      }),
    };
    const service = new PermissionService(
      prisma as never,
      redis as never,
      { get: (_k: string, fb?: unknown) => fb } as never,
    );
    await expect(service.codesForAccount('acct')).resolves.toEqual([]);
  });
});
