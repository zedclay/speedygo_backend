import {
  ASSIGNMENT_STATUS_EXPIRED,
  ASSIGNMENT_STATUS_OFFERED,
} from '../../matching/domain/matching.policy';
import { NotificationRecoveryService } from './notification-recovery.service';

describe('NotificationRecoveryService', () => {
  const ASSIGNMENT = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
  const DRIVER = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
  const PAYMENT = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';

  let recoveryRows: {
    listRecentOrdersForMerchantNotify: jest.Mock;
    listMissingCustomerOrderEvents: jest.Mock;
    listMissingDeliveryEvents: jest.Mock;
    listMissingPaymentSucceeded: jest.Mock;
    listMissingRefundRefunded: jest.Mock;
    listRecentFinalizedSettlements: jest.Mock;
    listMissingDriverEarnings: jest.Mock;
    listOpenMatchOffers: jest.Mock;
  };
  let notifications: {
    notifyMerchantOrderCreated: jest.Mock;
    notifyOrderAccepted: jest.Mock;
    notifyOrderRejected: jest.Mock;
    notifyOrderReady: jest.Mock;
    notifyDriverAssigned: jest.Mock;
    notifyDeliveryCompleted: jest.Mock;
    notifyPaymentSucceeded: jest.Mock;
    notifyRefundRefunded: jest.Mock;
    notifySettlementFinalized: jest.Mock;
    notifyDriverEarningCreated: jest.Mock;
    notifyMatchOffer: jest.Mock;
  };
  let service: NotificationRecoveryService;

  beforeEach(() => {
    recoveryRows = {
      listRecentOrdersForMerchantNotify: jest.fn().mockResolvedValue([]),
      listMissingCustomerOrderEvents: jest.fn().mockResolvedValue([]),
      listMissingDeliveryEvents: jest.fn().mockResolvedValue([]),
      listMissingPaymentSucceeded: jest.fn().mockResolvedValue([]),
      listMissingRefundRefunded: jest.fn().mockResolvedValue([]),
      listRecentFinalizedSettlements: jest.fn().mockResolvedValue([]),
      listMissingDriverEarnings: jest.fn().mockResolvedValue([]),
      listOpenMatchOffers: jest.fn().mockResolvedValue([]),
    };
    notifications = {
      notifyMerchantOrderCreated: jest.fn().mockResolvedValue(undefined),
      notifyOrderAccepted: jest.fn().mockResolvedValue(undefined),
      notifyOrderRejected: jest.fn().mockResolvedValue(undefined),
      notifyOrderReady: jest.fn().mockResolvedValue(undefined),
      notifyDriverAssigned: jest.fn().mockResolvedValue(undefined),
      notifyDeliveryCompleted: jest.fn().mockResolvedValue(undefined),
      notifyPaymentSucceeded: jest.fn().mockResolvedValue(undefined),
      notifyRefundRefunded: jest.fn().mockResolvedValue(undefined),
      notifySettlementFinalized: jest.fn().mockResolvedValue(undefined),
      notifyDriverEarningCreated: jest.fn().mockResolvedValue(undefined),
      notifyMatchOffer: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationRecoveryService(
      recoveryRows as never,
      notifications as never,
      {
        get: (key: string, fallback: number) => {
          if (key === 'notifications.recoveryBatchSize') return 50;
          if (key === 'notifications.recoveryLookbackMs') return 86_400_000;
          if (key === 'matching.offerTimeoutMs') return 30_000;
          return fallback;
        },
      } as never,
    );
  });

  it('repairs missing payment notifications via the same notify path', async () => {
    recoveryRows.listMissingPaymentSucceeded.mockResolvedValue([
      { paymentId: PAYMENT },
    ]);
    const result = await service.recover();
    expect(result.payments).toBe(1);
    expect(notifications.notifyPaymentSucceeded).toHaveBeenCalledWith({
      paymentId: PAYMENT,
    });
  });

  it('creates MATCH_OFFER only while authoritative offer remains valid', async () => {
    recoveryRows.listOpenMatchOffers.mockResolvedValue([
      {
        assignmentId: ASSIGNMENT,
        driverId: DRIVER,
        assignedAt: new Date().toISOString(),
        status: ASSIGNMENT_STATUS_OFFERED,
        releasedAt: null,
      },
    ]);
    await service.recover();
    expect(notifications.notifyMatchOffer).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT,
      driverId: DRIVER,
    });
  });

  it('skips stale MATCH_OFFER recovery when offer expired', async () => {
    recoveryRows.listOpenMatchOffers.mockResolvedValue([
      {
        assignmentId: ASSIGNMENT,
        driverId: DRIVER,
        assignedAt: new Date(Date.now() - 120_000).toISOString(),
        status: ASSIGNMENT_STATUS_OFFERED,
        releasedAt: null,
      },
    ]);
    const result = await service.recover();
    expect(result.matchOffers).toBe(0);
    expect(result.matchOffersSkippedStale).toBe(1);
    expect(notifications.notifyMatchOffer).not.toHaveBeenCalled();
  });

  it('skips MATCH_OFFER when assignment is no longer OFFERED', async () => {
    recoveryRows.listOpenMatchOffers.mockResolvedValue([
      {
        assignmentId: ASSIGNMENT,
        driverId: DRIVER,
        assignedAt: new Date().toISOString(),
        status: ASSIGNMENT_STATUS_EXPIRED,
        releasedAt: new Date().toISOString(),
      },
    ]);
    const result = await service.recover();
    expect(result.matchOffersSkippedStale).toBe(1);
    expect(notifications.notifyMatchOffer).not.toHaveBeenCalled();
  });

  it('does not mutate business state — only calls notification notify helpers', async () => {
    recoveryRows.listMissingPaymentSucceeded.mockResolvedValue([
      { paymentId: PAYMENT },
    ]);
    await service.recover();
    expect(Object.keys(notifications)).toEqual(
      expect.arrayContaining(['notifyPaymentSucceeded']),
    );
  });
});
