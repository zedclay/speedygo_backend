import {
  MERCHANT_ERROR_CODES,
  merchantRoleForbidden,
  teamDuplicateInvite,
} from '../domain/merchant.errors';
import {
  MERCHANT_CAPABILITIES,
  roleHasCapability,
  parseMerchantMemberRole,
} from '../domain/merchant.policy';
import {
  TEAM_BRANCH_SCOPE_ALL,
  TEAM_INVITATION_TTL_MS,
  hashAcceptCode,
  type MerchantInvitationRecord,
  type MerchantTeamMemberRecord,
} from '../domain/merchant-team.types';
import { MerchantTeamService } from './merchant-team.service';

const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const ownerAccount = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1';
const coOwnerAccount = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa2';
const managerAccount = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa3';
const staffAccount = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa4';
const inviteeAccount = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa5';

const ownerMemberId = 'cccccccc-cccc-7ccc-8ccc-cccccccccc01';
const coOwnerMemberId = 'cccccccc-cccc-7ccc-8ccc-cccccccccc02';
const managerMemberId = 'cccccccc-cccc-7ccc-8ccc-cccccccccc03';
const staffMemberId = 'cccccccc-cccc-7ccc-8ccc-cccccccccc04';
const invitationId = 'dddddddd-dddd-7ddd-8ddd-dddddddddd01';

const now = new Date('2026-10-04T10:00:00.000Z');
const inviteePhone = '+213550000005';

const phones: Record<string, string> = {
  [ownerAccount]: '+213550000001',
  [coOwnerAccount]: '+213550000002',
  [managerAccount]: '+213550000003',
  [staffAccount]: '+213550000004',
  [inviteeAccount]: inviteePhone,
};

function member(
  id: string,
  accountId: string,
  role: string,
  version = 1,
): MerchantTeamMemberRecord {
  return {
    id,
    merchantId,
    accountId,
    role,
    version,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function invitation(
  overrides: Partial<MerchantInvitationRecord> = {},
): MerchantInvitationRecord {
  return {
    id: invitationId,
    merchantId,
    phone: inviteePhone,
    role: 'STAFF',
    status: 'PENDING',
    tokenHash: hashAcceptCode('known-code'),
    expiresAt: new Date(now.getTime() + TEAM_INVITATION_TTL_MS).toISOString(),
    createdByAccountId: ownerAccount,
    acceptedByAccountId: null,
    acceptedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: '2026-10-04T09:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; httpStatus: number; message: string };
  }
  throw new Error('expected promise to reject');
}

describe('MerchantTeamService', () => {
  const roleByAccount = new Map<string, string>();
  const access = { requireCapability: jest.fn() };
  const team = {
    listMembers: jest.fn(),
    findMemberById: jest.fn(),
    findMemberByAccount: jest.fn(),
    updateMemberRole: jest.fn(),
    deleteMember: jest.fn(),
    listAccountPhones: jest.fn(),
    findAccountIdByPhone: jest.fn(),
    findAccountPhone: jest.fn(),
    listPendingInvitations: jest.fn(),
    listPendingInvitationsByPhone: jest.fn(),
    findInvitationById: jest.fn(),
    findInvitationForMerchant: jest.fn(),
    createInvitation: jest.fn(),
    cancelInvitation: jest.fn(),
    regenerateInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
  };
  const merchants = {
    findMerchantsByIds: jest.fn(),
    findMerchant: jest.fn(),
  };
  const sessions = { revokeAllSessionsForAccount: jest.fn() };
  let service: MerchantTeamService;

  beforeEach(() => {
    jest.clearAllMocks();
    roleByAccount.clear();
    roleByAccount.set(ownerAccount, 'OWNER');
    roleByAccount.set(coOwnerAccount, 'OWNER');
    roleByAccount.set(managerAccount, 'MANAGER');
    roleByAccount.set(staffAccount, 'STAFF');

    access.requireCapability.mockImplementation(
      (accountId: string, _merchantId: string, capability: never) => {
        const roleName = roleByAccount.get(accountId);
        const role = roleName ? parseMerchantMemberRole(roleName) : null;
        if (!role) {
          return Promise.reject(
            Object.assign(new Error('not found'), {
              code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
            }),
          );
        }
        if (!roleHasCapability(role, capability)) {
          return Promise.reject(merchantRoleForbidden());
        }
        return Promise.resolve({
          member: member('self', accountId, role),
          merchant: { id: merchantId },
        });
      },
    );

    const members = [
      member(ownerMemberId, ownerAccount, 'OWNER'),
      member(coOwnerMemberId, coOwnerAccount, 'OWNER'),
      member(managerMemberId, managerAccount, 'MANAGER', 3),
      member(staffMemberId, staffAccount, 'STAFF', 2),
    ];
    team.listMembers.mockResolvedValue(members);
    team.findMemberById.mockImplementation((_m: string, id: string) =>
      Promise.resolve(members.find((row) => row.id === id) ?? null),
    );
    team.findMemberByAccount.mockImplementation((_m: string, id: string) =>
      Promise.resolve(members.find((row) => row.accountId === id) ?? null),
    );
    team.listAccountPhones.mockImplementation((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, phones[id] ?? null]))),
    );
    team.findAccountPhone.mockImplementation((id: string) =>
      Promise.resolve(phones[id] ?? null),
    );
    team.findAccountIdByPhone.mockResolvedValue(null);
    team.listPendingInvitations.mockResolvedValue([]);
    team.listPendingInvitationsByPhone.mockResolvedValue([]);
    sessions.revokeAllSessionsForAccount.mockResolvedValue(['s1']);
    merchants.findMerchant.mockResolvedValue({ id: merchantId, name: 'Cafe' });
    merchants.findMerchantsByIds.mockResolvedValue([
      { id: merchantId, name: 'Cafe' },
    ]);

    service = new MerchantTeamService(
      access as never,
      team as never,
      merchants as never,
      sessions as never,
    );
  });

  describe('getTeam', () => {
    it('lets an OWNER list members and invitations with manage capability', async () => {
      team.listPendingInvitations.mockResolvedValue([invitation()]);
      const view = await service.getTeam(ownerAccount, merchantId, now);
      expect(access.requireCapability).toHaveBeenCalledWith(
        ownerAccount,
        merchantId,
        MERCHANT_CAPABILITIES.TEAM_READ,
      );
      expect(view.capabilities).toEqual({ canManage: true });
      expect(view.members).toHaveLength(4);
      expect(view.members[0]).toEqual({
        id: ownerMemberId,
        phone: phones[ownerAccount],
        role: 'OWNER',
        branchScope: TEAM_BRANCH_SCOPE_ALL,
        isSelf: true,
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      expect(view.members[1]?.isSelf).toBe(false);
      expect(view.invitations).toHaveLength(1);
      expect(view.invitations[0]).toMatchObject({
        id: invitationId,
        phone: inviteePhone,
        role: 'STAFF',
        status: 'PENDING',
        branchScope: TEAM_BRANCH_SCOPE_ALL,
      });
    });

    it('never leaks token hashes or accept codes in the roster', async () => {
      team.listPendingInvitations.mockResolvedValue([invitation()]);
      const view = await service.getTeam(ownerAccount, merchantId, now);
      const json = JSON.stringify(view);
      expect(json).not.toContain('tokenHash');
      expect(json).not.toContain('acceptCode');
      expect(json).not.toContain(hashAcceptCode('known-code'));
    });

    it('lets a MANAGER read the team without manage capability', async () => {
      const view = await service.getTeam(managerAccount, merchantId, now);
      expect(view.capabilities).toEqual({ canManage: false });
      expect(view.members).toHaveLength(4);
    });

    it('forbids STAFF from listing the team (MERCHANT_ROLE_FORBIDDEN)', async () => {
      const error = await rejection(
        service.getTeam(staffAccount, merchantId, now),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      expect(error.httpStatus).toBe(403);
      expect(team.listMembers).not.toHaveBeenCalled();
    });

    it('hides the team from non-members (MERCHANT_NOT_FOUND)', async () => {
      const error = await rejection(
        service.getTeam(
          'ffffffff-ffff-7fff-8fff-ffffffffffff',
          merchantId,
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND);
    });

    it('marks lapsed PENDING invitations as EXPIRED for display', async () => {
      team.listPendingInvitations.mockResolvedValue([
        invitation({ expiresAt: '2026-10-04T09:59:59.000Z' }),
      ]);
      const view = await service.getTeam(ownerAccount, merchantId, now);
      expect(view.invitations[0]?.status).toBe('EXPIRED');
    });
  });

  describe('createInvitation', () => {
    beforeEach(() => {
      team.createInvitation.mockImplementation((input: { tokenHash: string }) =>
        Promise.resolve(invitation({ tokenHash: input.tokenHash })),
      );
    });

    it('creates an invitation, returns the code once and stores only the hash', async () => {
      const view = await service.createInvitation(
        ownerAccount,
        merchantId,
        { phone: '0550 00 00 05', role: 'STAFF' },
        now,
      );
      expect(access.requireCapability).toHaveBeenCalledWith(
        ownerAccount,
        merchantId,
        MERCHANT_CAPABILITIES.TEAM_MANAGE,
      );
      expect(view.acceptCode).toMatch(/^[0-9a-f]{64}$/);
      expect(view.status).toBe('PENDING');
      expect(view.phone).toBe(inviteePhone);
      const [stored] = team.createInvitation.mock.calls[0] as [
        {
          phone: string;
          role: string;
          tokenHash: string;
          expiresAt: Date;
          createdByAccountId: string;
        },
      ];
      expect(stored.phone).toBe(inviteePhone);
      expect(stored.role).toBe('STAFF');
      expect(stored.tokenHash).toBe(hashAcceptCode(view.acceptCode));
      expect(stored.tokenHash).not.toBe(view.acceptCode);
      expect(JSON.stringify(stored)).not.toContain(view.acceptCode);
      expect(stored.expiresAt.getTime()).toBe(
        now.getTime() + TEAM_INVITATION_TTL_MS,
      );
      expect(stored.createdByAccountId).toBe(ownerAccount);
      expect(view).not.toHaveProperty('tokenHash');
    });

    it('issues a different code each time', async () => {
      const first = await service.createInvitation(
        ownerAccount,
        merchantId,
        { phone: '+213550000005', role: 'MANAGER' },
        now,
      );
      const second = await service.createInvitation(
        ownerAccount,
        merchantId,
        { phone: '+213550000005', role: 'MANAGER' },
        now,
      );
      expect(first.acceptCode).not.toBe(second.acceptCode);
    });

    it('forbids MANAGER and STAFF from inviting', async () => {
      for (const actor of [managerAccount, staffAccount]) {
        const error = await rejection(
          service.createInvitation(
            actor,
            merchantId,
            { phone: inviteePhone, role: 'STAFF' },
            now,
          ),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      }
      expect(team.createInvitation).not.toHaveBeenCalled();
    });

    it('refuses to assign OWNER (TEAM_OWNER_PROTECTED)', async () => {
      const error = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: inviteePhone, role: 'OWNER' },
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED);
      expect(team.createInvitation).not.toHaveBeenCalled();
    });

    it('rejects unknown roles and invalid phones (TEAM_INVALID_INPUT)', async () => {
      const badRole = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: inviteePhone, role: 'ADMIN' },
          now,
        ),
      );
      expect(badRole.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
      const badPhone = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: 'not-a-phone', role: 'STAFF' },
          now,
        ),
      );
      expect(badPhone.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
      const blankPhone = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: '   ', role: 'STAFF' },
          now,
        ),
      );
      expect(blankPhone.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
    });

    it('rejects branch assignment bodies (merchant-wide only)', async () => {
      for (const extra of [
        { branchId: 'x' },
        { branchIds: [] },
        { branchScope: 'BRANCH' },
      ]) {
        const error = await rejection(
          service.createInvitation(
            ownerAccount,
            merchantId,
            { phone: inviteePhone, role: 'STAFF', ...extra },
            now,
          ),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
      }
      expect(team.createInvitation).not.toHaveBeenCalled();
    });

    it('rejects a phone that already belongs to a member (TEAM_DUPLICATE_MEMBER)', async () => {
      team.findAccountIdByPhone.mockResolvedValue(staffAccount);
      const error = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: phones[staffAccount], role: 'MANAGER' },
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_DUPLICATE_MEMBER);
      expect(error.httpStatus).toBe(409);
      expect(team.createInvitation).not.toHaveBeenCalled();
    });

    it('allows inviting a phone whose Account belongs to another Merchant only', async () => {
      team.findAccountIdByPhone.mockResolvedValue(inviteeAccount);
      const view = await service.createInvitation(
        ownerAccount,
        merchantId,
        { phone: inviteePhone, role: 'STAFF' },
        now,
      );
      expect(view.status).toBe('PENDING');
    });

    it('surfaces a duplicate pending invitation (TEAM_DUPLICATE_INVITE)', async () => {
      team.createInvitation.mockRejectedValue(teamDuplicateInvite());
      const error = await rejection(
        service.createInvitation(
          ownerAccount,
          merchantId,
          { phone: inviteePhone, role: 'STAFF' },
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_DUPLICATE_INVITE);
      expect(error.httpStatus).toBe(409);
    });
  });

  describe('cancelInvitation', () => {
    it('cancels a pending invitation with a matching version', async () => {
      team.findInvitationForMerchant.mockResolvedValue(invitation());
      team.cancelInvitation.mockResolvedValue(
        invitation({ status: 'CANCELLED', version: 2 }),
      );
      const view = await service.cancelInvitation(
        ownerAccount,
        merchantId,
        invitationId,
        1,
        now,
      );
      expect(team.cancelInvitation).toHaveBeenCalledWith({
        merchantId,
        invitationId,
        expectedVersion: 1,
      });
      expect(view.status).toBe('CANCELLED');
      expect(view.version).toBe(2);
    });

    it('is OWNER only', async () => {
      for (const actor of [managerAccount, staffAccount]) {
        const error = await rejection(
          service.cancelInvitation(actor, merchantId, invitationId, 1, now),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      }
      expect(team.cancelInvitation).not.toHaveBeenCalled();
    });

    it('answers TEAM_INVITE_NOT_FOUND for unknown or already closed invitations', async () => {
      team.findInvitationForMerchant.mockResolvedValue(null);
      const missing = await rejection(
        service.cancelInvitation(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(missing.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
      team.findInvitationForMerchant.mockResolvedValue(
        invitation({ status: 'CANCELLED' }),
      );
      const closed = await rejection(
        service.cancelInvitation(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(closed.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
    });

    it('answers TEAM_VERSION_CONFLICT for a stale version', async () => {
      team.findInvitationForMerchant.mockResolvedValue(
        invitation({ version: 4 }),
      );
      const error = await rejection(
        service.cancelInvitation(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      expect(error.httpStatus).toBe(409);
      expect(team.cancelInvitation).not.toHaveBeenCalled();
    });

    it('answers TEAM_VERSION_CONFLICT when the guarded write loses a race', async () => {
      team.findInvitationForMerchant.mockResolvedValue(invitation());
      team.cancelInvitation.mockResolvedValue(null);
      const error = await rejection(
        service.cancelInvitation(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
    });

    it('rejects a missing or invalid expectedVersion', async () => {
      const error = await rejection(
        service.cancelInvitation(
          ownerAccount,
          merchantId,
          invitationId,
          0,
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
    });
  });

  describe('regenerateInvitationCode', () => {
    it('stores a new hash, extends expiry and returns the new code once', async () => {
      team.findInvitationForMerchant.mockResolvedValue(invitation());
      team.regenerateInvitation.mockImplementation(
        (input: { tokenHash: string }) =>
          Promise.resolve(
            invitation({ tokenHash: input.tokenHash, version: 2 }),
          ),
      );
      const view = await service.regenerateInvitationCode(
        ownerAccount,
        merchantId,
        invitationId,
        1,
        now,
      );
      const [call] = team.regenerateInvitation.mock.calls[0] as [
        {
          tokenHash: string;
          expectedVersion: number;
          expiresAt: Date;
        },
      ];
      expect(call.expectedVersion).toBe(1);
      expect(call.tokenHash).toBe(hashAcceptCode(view.acceptCode));
      expect(call.tokenHash).not.toBe(hashAcceptCode('known-code'));
      expect(call.expiresAt.getTime()).toBe(
        now.getTime() + TEAM_INVITATION_TTL_MS,
      );
      expect(view.version).toBe(2);
      expect(view.acceptCode).toMatch(/^[0-9a-f]{64}$/);
    });

    it('can revive an expired PENDING invitation', async () => {
      team.findInvitationForMerchant.mockResolvedValue(
        invitation({ expiresAt: '2026-09-01T00:00:00.000Z' }),
      );
      team.regenerateInvitation.mockResolvedValue(invitation({ version: 2 }));
      await expect(
        service.regenerateInvitationCode(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      ).resolves.toMatchObject({ status: 'PENDING' });
    });

    it('is OWNER only and enforces versions', async () => {
      const forbidden = await rejection(
        service.regenerateInvitationCode(
          managerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(forbidden.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      team.findInvitationForMerchant.mockResolvedValue(
        invitation({ version: 3 }),
      );
      const stale = await rejection(
        service.regenerateInvitationCode(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(stale.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      expect(team.regenerateInvitation).not.toHaveBeenCalled();
    });

    it('answers TEAM_INVITE_NOT_FOUND for accepted invitations', async () => {
      team.findInvitationForMerchant.mockResolvedValue(
        invitation({ status: 'ACCEPTED' }),
      );
      const error = await rejection(
        service.regenerateInvitationCode(
          ownerAccount,
          merchantId,
          invitationId,
          1,
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
    });
  });

  describe('updateMemberRole', () => {
    it('demotes MANAGER to STAFF and revokes the target sessions', async () => {
      team.updateMemberRole.mockResolvedValue(
        member(managerMemberId, managerAccount, 'STAFF', 4),
      );
      const view = await service.updateMemberRole(
        ownerAccount,
        merchantId,
        managerMemberId,
        { role: 'STAFF', expectedVersion: 3 },
      );
      expect(team.updateMemberRole).toHaveBeenCalledWith({
        merchantId,
        memberId: managerMemberId,
        expectedVersion: 3,
        role: 'STAFF',
      });
      expect(sessions.revokeAllSessionsForAccount).toHaveBeenCalledWith(
        managerAccount,
      );
      expect(view).toMatchObject({
        id: managerMemberId,
        role: 'STAFF',
        version: 4,
        isSelf: false,
      });
    });

    it('promotes STAFF to MANAGER without revoking sessions', async () => {
      team.updateMemberRole.mockResolvedValue(
        member(staffMemberId, staffAccount, 'MANAGER', 3),
      );
      const view = await service.updateMemberRole(
        ownerAccount,
        merchantId,
        staffMemberId,
        { role: 'MANAGER', expectedVersion: 2 },
      );
      expect(view.role).toBe('MANAGER');
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('is a no-op when the role is unchanged', async () => {
      const view = await service.updateMemberRole(
        ownerAccount,
        merchantId,
        staffMemberId,
        { role: 'STAFF', expectedVersion: 2 },
      );
      expect(view.version).toBe(2);
      expect(team.updateMemberRole).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('lets only OWNER manage members', async () => {
      for (const actor of [managerAccount, staffAccount]) {
        const error = await rejection(
          service.updateMemberRole(actor, merchantId, staffMemberId, {
            role: 'MANAGER',
            expectedVersion: 2,
          }),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      }
      expect(team.updateMemberRole).not.toHaveBeenCalled();
    });

    it('protects OWNER members from demotion', async () => {
      const error = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, coOwnerMemberId, {
          role: 'STAFF',
          expectedVersion: 1,
        }),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED);
      expect(team.updateMemberRole).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('refuses self-demotion (TEAM_SELF_FORBIDDEN)', async () => {
      const error = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, ownerMemberId, {
          role: 'STAFF',
          expectedVersion: 1,
        }),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_SELF_FORBIDDEN);
      expect(team.updateMemberRole).not.toHaveBeenCalled();
    });

    it('refuses to assign OWNER through a role change', async () => {
      const error = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, staffMemberId, {
          role: 'OWNER',
          expectedVersion: 2,
        }),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED);
      expect(team.updateMemberRole).not.toHaveBeenCalled();
    });

    it('rejects unknown roles and branch assignment bodies', async () => {
      const role = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, staffMemberId, {
          role: 'CREATOR',
          expectedVersion: 2,
        }),
      );
      expect(role.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
      const branch = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, staffMemberId, {
          role: 'MANAGER',
          expectedVersion: 2,
          branchId: 'x',
        }),
      );
      expect(branch.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
    });

    it('answers TEAM_VERSION_CONFLICT on a stale version', async () => {
      const error = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, managerMemberId, {
          role: 'STAFF',
          expectedVersion: 1,
        }),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      expect(error.httpStatus).toBe(409);
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('answers TEAM_VERSION_CONFLICT when the guarded write loses a race', async () => {
      team.updateMemberRole.mockResolvedValue(null);
      const error = await rejection(
        service.updateMemberRole(ownerAccount, merchantId, managerMemberId, {
          role: 'STAFF',
          expectedVersion: 3,
        }),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('does not reveal members of other Merchants', async () => {
      const error = await rejection(
        service.updateMemberRole(
          ownerAccount,
          merchantId,
          'cccccccc-cccc-7ccc-8ccc-cccccccccc99',
          { role: 'STAFF', expectedVersion: 1 },
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND);
      expect(error.httpStatus).toBe(404);
    });
  });

  describe('revokeMember', () => {
    it('removes the membership and revokes every target session', async () => {
      team.deleteMember.mockResolvedValue(true);
      const result = await service.revokeMember(
        ownerAccount,
        merchantId,
        managerMemberId,
        3,
      );
      expect(team.deleteMember).toHaveBeenCalledWith({
        merchantId,
        memberId: managerMemberId,
        expectedVersion: 3,
      });
      expect(sessions.revokeAllSessionsForAccount).toHaveBeenCalledWith(
        managerAccount,
      );
      expect(result).toEqual({ memberId: managerMemberId, revoked: true });
    });

    it('is OWNER only', async () => {
      for (const actor of [managerAccount, staffAccount]) {
        const error = await rejection(
          service.revokeMember(actor, merchantId, staffMemberId, 2),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
      }
      expect(team.deleteMember).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('protects OWNER members from revocation', async () => {
      const error = await rejection(
        service.revokeMember(ownerAccount, merchantId, coOwnerMemberId, 1),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED);
      expect(team.deleteMember).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('refuses self-revocation (TEAM_SELF_FORBIDDEN)', async () => {
      const error = await rejection(
        service.revokeMember(ownerAccount, merchantId, ownerMemberId, 1),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_SELF_FORBIDDEN);
      expect(team.deleteMember).not.toHaveBeenCalled();
    });

    it('answers TEAM_VERSION_CONFLICT on stale versions and lost races', async () => {
      const stale = await rejection(
        service.revokeMember(ownerAccount, merchantId, managerMemberId, 1),
      );
      expect(stale.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      team.deleteMember.mockResolvedValue(false);
      const raced = await rejection(
        service.revokeMember(ownerAccount, merchantId, managerMemberId, 3),
      );
      expect(raced.code).toBe(MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT);
      expect(sessions.revokeAllSessionsForAccount).not.toHaveBeenCalled();
    });

    it('rejects an invalid expectedVersion', async () => {
      const error = await rejection(
        service.revokeMember(
          ownerAccount,
          merchantId,
          managerMemberId,
          Number.NaN,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT);
    });

    it('answers MERCHANT_NOT_FOUND for an unknown member', async () => {
      const error = await rejection(
        service.revokeMember(
          ownerAccount,
          merchantId,
          'cccccccc-cccc-7ccc-8ccc-cccccccccc99',
          1,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND);
    });
  });

  describe('listMyInvitations', () => {
    it('lists unexpired pending invitations for the Account phone', async () => {
      team.listPendingInvitationsByPhone.mockResolvedValue([
        invitation(),
        invitation({
          id: 'dddddddd-dddd-7ddd-8ddd-dddddddddd02',
          expiresAt: '2026-10-01T00:00:00.000Z',
        }),
      ]);
      const view = await service.listMyInvitations(inviteeAccount, now);
      expect(team.listPendingInvitationsByPhone).toHaveBeenCalledWith(
        inviteePhone,
      );
      expect(view.invitations).toEqual([
        {
          id: invitationId,
          merchantId,
          merchantName: 'Cafe',
          role: 'STAFF',
          expiresAt: expect.any(String) as string,
          branchScope: TEAM_BRANCH_SCOPE_ALL,
          createdAt: '2026-10-04T09:00:00.000Z',
        },
      ]);
      expect(JSON.stringify(view)).not.toContain('tokenHash');
    });

    it('returns nothing for an Account without a phone', async () => {
      team.findAccountPhone.mockResolvedValue(null);
      await expect(
        service.listMyInvitations(inviteeAccount, now),
      ).resolves.toEqual({ invitations: [] });
      expect(team.listPendingInvitationsByPhone).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvitation', () => {
    beforeEach(() => {
      team.findInvitationById.mockResolvedValue(invitation());
      team.acceptInvitation.mockResolvedValue(
        member('eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee', inviteeAccount, 'STAFF'),
      );
    });

    it('creates a merchant-wide membership with the invited role', async () => {
      const view = await service.acceptInvitation(
        inviteeAccount,
        invitationId,
        'known-code',
        now,
      );
      expect(team.acceptInvitation).toHaveBeenCalledWith({
        invitation: invitation(),
        accountId: inviteeAccount,
      });
      expect(view).toEqual({
        merchantId,
        memberId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
        role: 'STAFF',
        branchScope: TEAM_BRANCH_SCOPE_ALL,
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
      });
    });

    it('rejects an invalid code (TEAM_INVITE_CODE_INVALID)', async () => {
      const wrong = await rejection(
        service.acceptInvitation(inviteeAccount, invitationId, 'nope', now),
      );
      expect(wrong.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_CODE_INVALID);
      expect(wrong.httpStatus).toBe(400);
      const empty = await rejection(
        service.acceptInvitation(inviteeAccount, invitationId, '', now),
      );
      expect(empty.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_CODE_INVALID);
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('rejects a regenerated (superseded) code', async () => {
      team.findInvitationById.mockResolvedValue(
        invitation({ tokenHash: hashAcceptCode('fresh-code'), version: 2 }),
      );
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_CODE_INVALID);
    });

    it('rejects a different phone (TEAM_PHONE_MISMATCH) even with the right code', async () => {
      const error = await rejection(
        service.acceptInvitation(staffAccount, invitationId, 'known-code', now),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_PHONE_MISMATCH);
      expect(error.httpStatus).toBe(403);
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('rejects an Account without a phone as a mismatch', async () => {
      team.findAccountPhone.mockResolvedValue(null);
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_PHONE_MISMATCH);
    });

    it('rejects an expired invitation (TEAM_INVITE_EXPIRED)', async () => {
      team.findInvitationById.mockResolvedValue(
        invitation({ expiresAt: '2026-10-04T10:00:00.000Z' }),
      );
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_EXPIRED);
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('treats unknown, cancelled and already accepted invitations as not found', async () => {
      team.findInvitationById.mockResolvedValue(null);
      const unknown = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(unknown.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
      for (const status of ['CANCELLED', 'ACCEPTED', 'EXPIRED']) {
        team.findInvitationById.mockResolvedValue(invitation({ status }));
        const error = await rejection(
          service.acceptInvitation(
            inviteeAccount,
            invitationId,
            'known-code',
            now,
          ),
        );
        expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
      }
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('rejects when the Account is already a member (TEAM_DUPLICATE_MEMBER)', async () => {
      team.findMemberByAccount.mockResolvedValue(
        member('x', inviteeAccount, 'STAFF'),
      );
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_DUPLICATE_MEMBER);
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('never grants OWNER even if a tampered row carries it', async () => {
      team.findInvitationById.mockResolvedValue(invitation({ role: 'OWNER' }));
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED);
      expect(team.acceptInvitation).not.toHaveBeenCalled();
    });

    it('does not accept for a vanished Merchant', async () => {
      merchants.findMerchant.mockResolvedValue(null);
      const error = await rejection(
        service.acceptInvitation(
          inviteeAccount,
          invitationId,
          'known-code',
          now,
        ),
      );
      expect(error.code).toBe(MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND);
    });
  });
});
