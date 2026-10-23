import { NotificationService } from './notification.service';
import {
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
} from '../domain/notification.types';

const ACCOUNT = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const SOURCE = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const NOTIF_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const DRIVER = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';

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
    findAdminAccountIdsWithPermission: jest.Mock;
    findAdminRecipientsWithPermission: jest.Mock;
    resurfaceOwned: jest.Mock;
    findNotificationTemplateByCode: jest.Mock;
  };
  let service: NotificationService;
  let push: { isConfigured: jest.Mock };
  let jobs: { ensureRecoverySchedule: jest.Mock; enqueuePushSend: jest.Mock };

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
      findAdminAccountIdsWithPermission: jest
        .fn()
        .mockResolvedValue([ACCOUNT]),
      findAdminRecipientsWithPermission: jest.fn().mockResolvedValue([
        { accountId: ACCOUNT, preferredLocale: 'fr' },
      ]),
      resurfaceOwned: jest.fn().mockResolvedValue({
        id: NOTIF_ID,
        accountId: ACCOUNT,
        read: false,
        title: 'Vérification livreur à examiner',
        body: 'Documents du livreur Ada soumis pour revue.',
        category: `${NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF}:${DRIVER}`,
        templateId: null,
        createdAt: '2026-10-18T08:00:00.000Z',
      }),
      findNotificationTemplateByCode: jest.fn().mockResolvedValue(null),
    };
    push = { isConfigured: jest.fn().mockReturnValue(false) };
    jobs = {
      ensureRecoverySchedule: jest.fn(),
      enqueuePushSend: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationService(
      notifications as never,
      push as never,
      jobs as never,
    );
  });

  it('push-enabled type writes PENDING Push log and enqueues after commit when configured', async () => {
    push.isConfigured.mockReturnValue(true);
    await service.emitSafe({
      type: NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Nouvelle commande',
      body: 'body',
    });
    const statuses = (
      notifications.createDeliveryLog.mock.calls as Array<
        [{ channel: string; status: string }]
      >
    ).map((c) => `${c[0].channel}:${c[0].status}`);
    expect(statuses).toEqual(['IN_APP:SENT', 'PUSH:PENDING']);
    expect(jobs.enqueuePushSend).toHaveBeenCalledWith(NOTIF_ID);
  });

  it('push-enabled type stays SKIPPED_NOT_CONFIGURED and is not enqueued without provider', async () => {
    await service.emitSafe({
      type: NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Nouvelle commande',
      body: 'body',
    });
    const calls = notifications.createDeliveryLog.mock.calls as Array<
      [{ status: string }]
    >;
    expect(calls[1][0].status).toBe('SKIPPED_NOT_CONFIGURED');
    expect(jobs.enqueuePushSend).not.toHaveBeenCalled();
  });

  it('non push-enabled types never enqueue even when provider is configured', async () => {
    push.isConfigured.mockReturnValue(true);
    await service.emitSafe({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Payment successful',
      body: 'Your payment was confirmed.',
    });
    expect(jobs.enqueuePushSend).not.toHaveBeenCalled();
  });

  it('push enqueue failure does not throw and keeps the inbox row', async () => {
    push.isConfigured.mockReturnValue(true);
    jobs.enqueuePushSend.mockRejectedValue(new Error('redis down'));
    await expect(
      service.emitSafe({
        type: NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
        sourceId: SOURCE,
        accountId: ACCOUNT,
        title: 'Nouvelle commande',
        body: 'body',
      }),
    ).resolves.toBeUndefined();
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
  });

  it('idempotent replay does not enqueue a second push', async () => {
    push.isConfigured.mockReturnValue(true);
    notifications.findByAccountCategory.mockResolvedValue([{ id: NOTIF_ID }]);
    await service.emitSafe({
      type: NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
      sourceId: SOURCE,
      accountId: ACCOUNT,
      title: 'Nouvelle commande',
      body: 'body',
    });
    expect(jobs.enqueuePushSend).not.toHaveBeenCalled();
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

  it('Driver Admin VERIF: live resubmit resurfaces existing row; recovery does not', async () => {
    const existing = {
      id: NOTIF_ID,
      accountId: ACCOUNT,
      read: true,
      title: 'Vérification livreur à examiner',
      body: 'Documents du livreur Ada soumis pour revue.',
      category: `${NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF}:${DRIVER}`,
      templateId: null,
      createdAt: '2026-10-18T02:00:00.000Z',
    };
    notifications.findByAccountCategory.mockResolvedValue([existing]);

    await service.notifyAdminDriverVerificationSubmitted({
      driverId: DRIVER,
      driverFullName: 'Ada',
      resurfaceIfExists: false,
    });
    expect(notifications.resurfaceOwned).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();

    // Already-unread peers also resurface on live path (timestamp bump).
    notifications.findByAccountCategory.mockResolvedValue([
      { ...existing, read: false },
    ]);
    await service.notifyAdminDriverVerificationSubmitted({
      driverId: DRIVER,
      driverFullName: 'Ada',
      resurfaceIfExists: true,
    });
    expect(notifications.resurfaceOwned).toHaveBeenCalledWith(
      ACCOUNT,
      NOTIF_ID,
      'Vérification livreur à examiner',
      'Documents du livreur Ada soumis pour revue.',
    );
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('Admin emit uses active FR template when present', async () => {
    notifications.findNotificationTemplateByCode.mockResolvedValue({
      id: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
      code: 'ADMIN_DRIVER_VERIF__fr',
      audience: 'ADMIN',
      trigger: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      channel: 'IN_APP',
      titleTemplate: 'Custom {{driverFullName}}',
      bodyTemplate: 'Review {{driverFullName}} now',
      active: true,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
    });
    await service.notifyAdminDriverVerificationSubmitted({
      driverId: DRIVER,
      driverFullName: 'Ada',
      resurfaceIfExists: true,
    });
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Custom Ada',
        body: 'Review Ada now',
        templateId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
      }),
      expect.anything(),
    );
  });

  it('Admin emit uses AR template for preferredLocale=ar recipients', async () => {
    notifications.findAdminRecipientsWithPermission.mockResolvedValue([
      { accountId: ACCOUNT, preferredLocale: 'ar' },
    ]);
    notifications.findNotificationTemplateByCode.mockImplementation(
      async (code: string) => {
        if (code !== 'ADMIN_DRIVER_VERIF__ar') return null;
        return {
          id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1',
          code: 'ADMIN_DRIVER_VERIF__ar',
          audience: 'ADMIN',
          trigger: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
          channel: 'IN_APP',
          titleTemplate: 'AR {{driverFullName}}',
          bodyTemplate: 'مراجعة {{driverFullName}}',
          active: true,
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
        };
      },
    );
    await service.notifyAdminDriverVerificationSubmitted({
      driverId: DRIVER,
      driverFullName: 'Ada',
      resurfaceIfExists: true,
    });
    expect(notifications.findNotificationTemplateByCode).toHaveBeenCalledWith(
      'ADMIN_DRIVER_VERIF__ar',
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'AR Ada',
        body: 'مراجعة Ada',
        templateId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1',
      }),
      expect.anything(),
    );
  });

  it('inactive AR falls back to AR seed defaults, not FR catalogue', async () => {
    notifications.findAdminRecipientsWithPermission.mockResolvedValue([
      { accountId: ACCOUNT, preferredLocale: 'ar' },
    ]);
    notifications.findNotificationTemplateByCode.mockImplementation(
      async (code: string) => {
        if (code === 'ADMIN_DRIVER_VERIF__ar') {
          return {
            id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1',
            code,
            audience: 'ADMIN',
            trigger: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
            channel: 'IN_APP',
            titleTemplate: 'INACTIVE AR {{driverFullName}}',
            bodyTemplate: 'should not emit',
            active: false,
            createdAt: '2026-10-18T00:00:00.000Z',
            updatedAt: '2026-10-18T00:00:00.000Z',
          };
        }
        // FR catalogue deliberately customized — must not be used for AR recipient
        return {
          id: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
          code: 'ADMIN_DRIVER_VERIF__fr',
          audience: 'ADMIN',
          trigger: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
          channel: 'IN_APP',
          titleTemplate: 'FR CUSTOM {{driverFullName}}',
          bodyTemplate: 'FR body',
          active: true,
          createdAt: '2026-10-18T00:00:00.000Z',
          updatedAt: '2026-10-18T00:00:00.000Z',
        };
      },
    );
    await service.notifyAdminDriverVerificationSubmitted({
      driverId: DRIVER,
      driverFullName: 'Ada',
      resurfaceIfExists: true,
    });
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'تحقق السائق للمراجعة',
        body: 'تم تقديم وثائق السائق Ada للمراجعة.',
        templateId: null,
      }),
      expect.anything(),
    );
  });
});
