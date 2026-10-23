import { AdminCustomerCommandsService } from './admin-customer-commands.service';

describe('AdminCustomerCommandsService', () => {
  const admin = {
    adminProfileId: 'adm-1',
    accountId: 'acct-actor',
    sessionId: 'sess-1',
    displayName: 'Actor',
    roleId: 'role-1',
    roleName: 'ops',
    permissions: ['customers.suspend'],
    preferredLocale: 'fr',
  };

  function build(overrides: {
    customer?: { id: string; accountId: string } | null;
    account?: { id: string; status: string } | null;
    colocated?: {
      hasAdminProfile: boolean;
      hasDriverProfile: boolean;
      hasMerchantMembership: boolean;
    };
  }) {
    const customer =
      overrides.customer === undefined
        ? { id: 'cust-1', accountId: 'acct-target' }
        : overrides.customer;
    const account =
      overrides.account === undefined
        ? { id: 'acct-target', status: 'ACTIVE' }
        : overrides.account;
    const colocated = overrides.colocated ?? {
      hasAdminProfile: false,
      hasDriverProfile: false,
      hasMerchantMembership: false,
    };

    const tx = {
      orm: {
        public: {
          CustomerProfile: {
            where: () => ({
              first: async () => customer,
            }),
          },
          Account: {
            where: () => ({
              first: async () => account,
            }),
          },
          AdminProfile: {
            where: () => ({
              first: async () =>
                colocated.hasAdminProfile ? { id: 'ap' } : null,
            }),
          },
          DriverProfile: {
            where: () => ({
              first: async () =>
                colocated.hasDriverProfile ? { id: 'dp' } : null,
            }),
          },
          MerchantMember: {
            where: () => ({
              first: async () =>
                colocated.hasMerchantMembership ? { id: 'mm' } : null,
            }),
          },
        },
      },
    };

    const prisma = {
      getDb: () => ({
        transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      }),
    };
    const rbacRepo = {
      updateAccountStatusInTx: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      revokeAllSessionsForAccountInTx: jest
        .fn()
        .mockResolvedValue(['s1', 's2']),
      finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
    };
    const permissions = { invalidate: jest.fn().mockResolvedValue(undefined) };
    const tracking = { disconnectSessions: jest.fn() };
    const audit = { recordInTx: jest.fn().mockResolvedValue(undefined) };

    const service = new AdminCustomerCommandsService(
      prisma as never,
      rbacRepo as never,
      sessions as never,
      permissions as never,
      tracking as never,
      audit as never,
    );
    return { service, rbacRepo, sessions, audit, permissions, tracking };
  }

  it('suspends ACTIVE Account and revokes sessions', async () => {
    const { service, rbacRepo, sessions, audit } = build({});
    const result = await service.suspend(admin, 'cust-1', 'fraud review');
    expect(result.accountStatus).toBe('SUSPENDED');
    expect(result.alreadyApplied).toBe(false);
    expect(result.sessionsRevoked).toBe(2);
    expect(rbacRepo.updateAccountStatusInTx).toHaveBeenCalled();
    expect(sessions.revokeAllSessionsForAccountInTx).toHaveBeenCalled();
    expect(audit.recordInTx).toHaveBeenCalled();
  });

  it('refuses Accounts that host an AdminProfile', async () => {
    const { service } = build({
      colocated: {
        hasAdminProfile: true,
        hasDriverProfile: false,
        hasMerchantMembership: false,
      },
    });
    await expect(service.suspend(admin, 'cust-1')).rejects.toMatchObject({
      code: 'ADMIN_CUSTOMER_ACCOUNT_CONFLICT',
    });
  });

  it('refuses self Account lifecycle via customer routes', async () => {
    const { service } = build({
      customer: { id: 'cust-1', accountId: 'acct-actor' },
      account: { id: 'acct-actor', status: 'ACTIVE' },
    });
    await expect(service.suspend(admin, 'cust-1')).rejects.toMatchObject({
      code: 'ADMIN_FORBIDDEN',
    });
  });

  it('reactivates SUSPENDED Account without session revoke', async () => {
    const { service, sessions, rbacRepo } = build({
      account: { id: 'acct-target', status: 'SUSPENDED' },
    });
    const result = await service.reactivate(admin, 'cust-1');
    expect(result.accountStatus).toBe('ACTIVE');
    expect(result.sessionsRevoked).toBe(0);
    expect(rbacRepo.updateAccountStatusInTx).toHaveBeenCalled();
    expect(sessions.revokeAllSessionsForAccountInTx).not.toHaveBeenCalled();
  });
});
