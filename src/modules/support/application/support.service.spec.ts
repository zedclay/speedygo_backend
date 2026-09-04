import { SUPPORT_ERROR_CODES } from '../domain/support.errors';
import {
  SUPPORT_PRIORITY_HIGH,
  SUPPORT_PRIORITY_NORMAL,
  SUPPORT_STATUS_CLOSED,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_RESOLVED,
  SUPPORT_STATUS_WAITING_CUSTOMER,
} from '../domain/support.policy';
import {
  toAdminTicketDetail,
  toUserTicketDetail,
  type SupportTicketRecord,
} from '../domain/support.types';
import { SupportService } from './support.service';
import { userDetailOmitsInternalNotes } from './support-admin.service';

function ticket(
  overrides: Partial<SupportTicketRecord> = {},
): SupportTicketRecord {
  return {
    id: 't1',
    publicReference: 'sgt_abc',
    createdByAccountId: 'acct-owner',
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

describe('SupportService ownership and transitions', () => {
  function buildService(repo: Record<string, jest.Mock>) {
    const merchantAccess = {
      requireMembership: jest.fn(),
    };
    return {
      service: new SupportService(repo as never, merchantAccess as never),
      merchantAccess,
    };
  }

  it('blocks foreign customer get', async () => {
    const repo = {
      findTicket: jest
        .fn()
        .mockResolvedValue(ticket({ createdByAccountId: 'other' })),
    };
    const { service } = buildService(repo);
    await expect(
      service.getCustomerTicket('acct-owner', 't1'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_NOT_FOUND,
    });
  });

  it('rejects user reply on CLOSED without auto-reopen', async () => {
    const locked = ticket({ status: SUPPORT_STATUS_CLOSED });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      addMessage: jest.fn(),
    };
    const { service } = buildService(repo);
    await expect(
      service.replyCustomerTicket('acct-owner', 't1', 'hello again'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_STATE,
    });
    expect(repo.addMessage).not.toHaveBeenCalled();
  });

  it('moves WAITING_CUSTOMER to IN_PROGRESS on user reply with row lock', async () => {
    const locked = ticket({ status: SUPPORT_STATUS_WAITING_CUSTOMER });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      addMessage: jest.fn().mockResolvedValue({
        id: 'm1',
        ticketId: 't1',
        authorAccountId: 'acct-owner',
        body: 'reply',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    };
    const { service } = buildService(repo);
    await service.replyCustomerTicket('acct-owner', 't1', 'reply');
    expect(repo.lockTicket).toHaveBeenCalledWith('t1', {});
    expect(repo.addMessage).toHaveBeenCalledWith(
      't1',
      'acct-owner',
      'reply',
      {},
      { nextStatus: SUPPORT_STATUS_IN_PROGRESS },
    );
  });

  it('rejects foreign orderId on customer create', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest
        .fn()
        .mockResolvedValue({ id: 'cust-1', accountId: 'acct-owner' }),
      orderBelongsToCustomer: jest.fn().mockResolvedValue(false),
      runInTransaction: jest.fn(),
    };
    const { service } = buildService(repo);
    await expect(
      service.createCustomerTicket('acct-owner', 'help', 'order-x'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_RESOURCE_FORBIDDEN,
    });
    expect(repo.runInTransaction).not.toHaveBeenCalled();
  });

  it('blocks STAFF from merchant support', async () => {
    const repo = {};
    const { service, merchantAccess } = buildService(repo);
    merchantAccess.requireMembership.mockResolvedValue({
      member: { role: 'STAFF' },
      merchant: { id: 'm1' },
    });
    await expect(
      service.createMerchantTicket('acct', 'm1', 'help please'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_FORBIDDEN,
    });
  });

  it('user ticket detail never includes internal notes', () => {
    const detail = toUserTicketDetail(ticket(), null, []);
    expect(userDetailOmitsInternalNotes(detail)).toBe(true);
    expect(detail).not.toHaveProperty('internalNotes');
  });

  it('admin ticket detail can include internal notes; user mapping omits them', () => {
    const adminDetail = toAdminTicketDetail(
      ticket(),
      null,
      [],
      [
        {
          id: 'n1',
          ticketId: 't1',
          adminId: 'a1',
          body: 'secret',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    );
    expect(adminDetail.internalNotes?.[0]?.body).toBe('secret');
    const userDetail = toUserTicketDetail(ticket(), null, []);
    expect(userDetail.internalNotes).toBeUndefined();
  });

  it('create always uses NORMAL priority regardless of client intent', async () => {
    const createdTicket = ticket({ priority: SUPPORT_PRIORITY_NORMAL });
    const repo = {
      findCustomerProfileByAccountId: jest
        .fn()
        .mockResolvedValue({ id: 'cust-1', accountId: 'acct-owner' }),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      createTicketWithFirstMessage: jest.fn().mockResolvedValue({
        ticket: createdTicket,
        message: {
          id: 'm1',
          ticketId: 't1',
          authorAccountId: 'acct-owner',
          body: 'help',
          createdAt: createdTicket.createdAt,
        },
      }),
      findOrderSafeContext: jest.fn(),
    };
    const { service } = buildService(repo);
    const result = await service.createCustomerTicket('acct-owner', 'help');
    expect(result.priority).toBe(SUPPORT_PRIORITY_NORMAL);
    expect(result.priority).not.toBe(SUPPORT_PRIORITY_HIGH);
    expect(repo.createTicketWithFirstMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByAccountId: 'acct-owner',
        merchantId: null,
        driverId: null,
      }),
      {},
    );
  });

  it('rejects reply on RESOLVED', async () => {
    const locked = ticket({ status: SUPPORT_STATUS_RESOLVED });
    const repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockTicket: jest.fn().mockResolvedValue(locked),
      addMessage: jest.fn(),
    };
    const { service } = buildService(repo);
    await expect(
      service.replyCustomerTicket('acct-owner', 't1', 'ping'),
    ).rejects.toMatchObject({
      code: SUPPORT_ERROR_CODES.SUPPORT_INVALID_STATE,
    });
  });
});
