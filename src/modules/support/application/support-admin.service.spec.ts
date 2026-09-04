import { ADMIN_AUDIT_ACTIONS } from '../../admin/domain/admin-audit-actions';
import { ADMIN_PERMISSIONS } from '../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { SUPPORT_ERROR_CODES } from '../domain/support.errors';
import {
  SUPPORT_PRIORITY_NORMAL,
  SUPPORT_STATUS_CLOSED,
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_RESOLVED,
} from '../domain/support.policy';
import type { SupportTicketRecord } from '../domain/support.types';
import { SupportAdminService } from './support-admin.service';

function ticket(
  overrides: Partial<SupportTicketRecord> = {},
): SupportTicketRecord {
  return {
    id: 't1',
    publicReference: 'sgt_abc',
    createdByAccountId: 'acct-user',
    orderId: null,
    merchantId: null,
    driverId: null,
    status: SUPPORT_STATUS_OPEN,
    priority: SUPPORT_PRIORITY_NORMAL,
    assignedAdminId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function adminA(): CurrentAdminContext {
  return {
    adminProfileId: 'admin-a',
    accountId: 'acct-a',
    sessionId: 'sess-a',
    displayName: 'Admin A',
    roleId: 'role-a',
    roleName: 'Support',
    permissions: [
      ADMIN_PERMISSIONS.SUPPORT_READ,
      ADMIN_PERMISSIONS.SUPPORT_MANAGE,
    ],
  };
}

describe('SupportAdminService assignment authority', () => {
  function build(
    repo: Record<string, jest.Mock>,
    audit?: { recordInTx: jest.Mock },
  ) {
    return new SupportAdminService(
      repo as never,
      (audit ?? {
        recordInTx: jest.fn().mockResolvedValue(undefined),
      }) as never,
    );
  }

  it('assigns to active AdminProfile with support.manage; audit actor is CurrentAdmin', async () => {
    const locked = ticket();
    const updated = ticket({ assignedAdminId: 'admin-b' });
    const recordInTx = jest.fn().mockResolvedValue(undefined);
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      findAssignableAdmin: jest.fn().mockResolvedValue({
        adminId: 'admin-b',
        accountId: 'acct-b',
        permissions: [ADMIN_PERMISSIONS.SUPPORT_MANAGE],
      }),
      updateTicketAssignment: jest.fn().mockResolvedValue(updated),
    };
    const service = build(repo, { recordInTx });
    const result = await service.assign(adminA(), 't1', 'admin-b');
    expect(result.assignedAdminId).toBe('admin-b');
    expect(repo.findAssignableAdmin).toHaveBeenCalledWith('admin-b', {});
    expect(recordInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        adminId: 'admin-a',
        action: ADMIN_AUDIT_ACTIONS.SUPPORT_ASSIGN,
        afterJson: { assignedAdminId: 'admin-b' },
      }),
    );
  });

  it('denies assign to Admin with only support.read', async () => {
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(ticket()),
      findAssignableAdmin: jest.fn().mockResolvedValue({
        adminId: 'admin-read',
        accountId: 'acct-read',
        permissions: [ADMIN_PERMISSIONS.SUPPORT_READ],
      }),
      updateTicketAssignment: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.assign(adminA(), 't1', 'admin-read'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    });
    expect(repo.updateTicketAssignment).not.toHaveBeenCalled();
  });

  it('denies assign when Role is inactive (findAssignableAdmin null)', async () => {
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(ticket()),
      findAssignableAdmin: jest.fn().mockResolvedValue(null),
      updateTicketAssignment: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.assign(adminA(), 't1', 'admin-inactive'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    });
    expect(repo.updateTicketAssignment).not.toHaveBeenCalled();
  });

  it('denies assign to nonexistent AdminProfile', async () => {
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(ticket()),
      findAssignableAdmin: jest.fn().mockResolvedValue(null),
      updateTicketAssignment: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.assign(adminA(), 't1', '00000000-0000-7000-8000-000000000099'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    });
  });

  it('allows unassign to null without assignee lookup', async () => {
    const updated = ticket({ assignedAdminId: null });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest
        .fn()
        .mockResolvedValue(ticket({ assignedAdminId: 'admin-b' })),
      findAssignableAdmin: jest.fn(),
      updateTicketAssignment: jest.fn().mockResolvedValue(updated),
    };
    const service = build(repo);
    const result = await service.assign(adminA(), 't1', null);
    expect(result.assignedAdminId).toBeNull();
    expect(repo.findAssignableAdmin).not.toHaveBeenCalled();
  });

  it('last serialized assign wins under sequential lock transactions', async () => {
    let current: string | null = null;
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn(() =>
        Promise.resolve(ticket({ assignedAdminId: current })),
      ),
      findAssignableAdmin: jest.fn((id: string) =>
        Promise.resolve({
          adminId: id,
          accountId: `acct-${id}`,
          permissions: [ADMIN_PERMISSIONS.SUPPORT_MANAGE],
        }),
      ),
      updateTicketAssignment: jest.fn(
        (_id: string, assignee: string | null) => {
          current = assignee;
          return Promise.resolve(ticket({ assignedAdminId: assignee }));
        },
      ),
    };
    const service = build(repo);
    await service.assign(adminA(), 't1', 'admin-b');
    await service.assign(adminA(), 't1', 'admin-d');
    expect(current).toBe('admin-d');
    expect(repo.updateTicketAssignment).toHaveBeenCalledTimes(2);
  });

  it('reopens CLOSED to OPEN via explicit command', async () => {
    const locked = ticket({ status: SUPPORT_STATUS_CLOSED });
    const updated = ticket({ status: SUPPORT_STATUS_OPEN });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      updateTicketStatus: jest.fn().mockResolvedValue(updated),
    };
    const service = build(repo);
    const result = await service.reopen(adminA(), 't1');
    expect(result.status).toBe(SUPPORT_STATUS_OPEN);
    expect(repo.updateTicketStatus).toHaveBeenCalledWith(
      't1',
      SUPPORT_STATUS_OPEN,
      {},
    );
  });

  it('reopens RESOLVED to OPEN via explicit command', async () => {
    const locked = ticket({ status: SUPPORT_STATUS_RESOLVED });
    const updated = ticket({ status: SUPPORT_STATUS_OPEN });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      updateTicketStatus: jest.fn().mockResolvedValue(updated),
    };
    const service = build(repo);
    const result = await service.reopen(adminA(), 't1');
    expect(result.status).toBe(SUPPORT_STATUS_OPEN);
  });

  it('rejects arbitrary priority outside LOW|NORMAL|HIGH', async () => {
    const service = build({
      runInTransaction: jest.fn(),
      lockTicket: jest.fn(),
    });
    await expect(
      service.setPriority(adminA(), 't1', 'URGENT'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    });
  });
});
