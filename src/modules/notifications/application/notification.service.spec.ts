import { NotificationService } from './notification.service';
import { NOTIFICATION_TYPE_PAYMENT_SUCCEEDED } from '../domain/notification.types';

const ACCOUNT = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const SOURCE = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const NOTIF_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';

describe('NotificationService', () => {
  let notifications: {
    runInTransaction: jest.Mock;
    lockLogicalNotification: jest.Mock;
    findByAccountCategory: jest.Mock;
    createNotification: jest.Mock;
    createDeliveryLog: jest.Mock;
    findCustomerAccountIdByCustomerId: jest.Mock;
    findPaymentNotifyContext: jest.Mock;
    listForAccount: jest.Mock;
    countUnread: jest.Mock;
    findOwned: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
    listMerchantSettlementRecipientAccountIds: jest.Mock;
  };
  let service: NotificationService;

  beforeEach(() => {
    notifications = {
      runInTransaction: jest.fn(
        (fn: (tx: Record<string, never>) => Promise<unknown>) => fn({}),
      ),
      lockLogicalNotification: jest.fn().mockResolvedValue(undefined),
      findByAccountCategory: jest.fn().mockResolvedValue([]),
      createNotification: jest.fn().mockResolvedValue({
        id: NOTIF_ID,
        accountId: ACCOUNT,
        templateId: null,
        title: 'Payment successful',
        body: 'body',
        category: `PAYMENT_SUCCEEDED:${SOURCE}`,
        read: false,
        createdAt: '2026-09-04T00:00:00.000Z',
      }),
      createDeliveryLog: jest.fn().mockResolvedValue({}),
      findCustomerAccountIdByCustomerId: jest.fn().mockResolvedValue(ACCOUNT),
      findPaymentNotifyContext: jest.fn(),
      listForAccount: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      countUnread: jest.fn().mockResolvedValue(0),
      findOwned: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn().mockResolvedValue(2),
      listMerchantSettlementRecipientAccountIds: jest
        .fn()
        .mockResolvedValue([ACCOUNT]),
    };
    service = new NotificationService(notifications as never);
  });

  it('creates one logical notification and records IN_APP SENT plus PUSH skipped', async () => {
    const first = await service.emitLogical({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Payment successful',
      body: 'Your payment was confirmed.',
    });
    expect(first.created).toBe(true);
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createDeliveryLog).toHaveBeenCalledTimes(2);
    const deliveryCalls = notifications.createDeliveryLog.mock.calls as Array<
      [{ status: string }]
    >;
    expect(deliveryCalls[0][0].status).toBe('SENT');
    expect(deliveryCalls[1][0].status).toBe('SKIPPED_NOT_CONFIGURED');

    notifications.findByAccountCategory.mockResolvedValue([first.notification]);
    const second = await service.emitLogical({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Payment successful',
      body: 'Your payment was confirmed.',
    });
    expect(second.created).toBe(false);
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
  });

  it('fails closed when duplicate category rows exist', async () => {
    notifications.findByAccountCategory.mockResolvedValue([
      { id: '1' },
      { id: '2' },
    ]);
    await expect(
      service.emitLogical({
        type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
        sourceId: SOURCE,
        accountId: ACCOUNT,
        title: 'Payment successful',
        body: 'Your payment was confirmed.',
      }),
    ).rejects.toMatchObject({
      code: 'NOTIFICATION_INTEGRITY_CONFLICT',
    });
  });

  it('emitSafe swallows errors so business callers are isolated', async () => {
    notifications.runInTransaction.mockRejectedValue(new Error('db down'));
    await expect(
      service.emitSafe({
        type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
        sourceId: SOURCE,
        accountId: ACCOUNT,
        title: 'Payment successful',
        body: 'Your payment was confirmed.',
      }),
    ).resolves.toBeUndefined();
  });

  it('markRead is own-only and idempotent', async () => {
    notifications.findOwned.mockResolvedValue({
      id: NOTIF_ID,
      accountId: ACCOUNT,
      read: false,
      title: 't',
      body: 'b',
      category: `PAYMENT_SUCCEEDED:${SOURCE}`,
      templateId: null,
      createdAt: '2026-09-04T00:00:00.000Z',
    });
    notifications.markRead.mockResolvedValue({
      id: NOTIF_ID,
      accountId: ACCOUNT,
      read: true,
      title: 't',
      body: 'b',
      category: `PAYMENT_SUCCEEDED:${SOURCE}`,
      templateId: null,
      createdAt: '2026-09-04T00:00:00.000Z',
    });
    const view = await service.markRead(ACCOUNT, NOTIF_ID);
    expect(view.read).toBe(true);

    notifications.findOwned.mockResolvedValue(null);
    await expect(service.markRead(OTHER, NOTIF_ID)).rejects.toMatchObject({
      code: 'NOTIFICATION_NOT_FOUND',
    });
  });

  it('settlement fanout uses repository OWNER/MANAGER list only', async () => {
    await service.notifySettlementFinalized({
      settlementId: SOURCE,
      merchantId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
    });
    expect(
      notifications.listMerchantSettlementRecipientAccountIds,
    ).toHaveBeenCalled();
  });
});
