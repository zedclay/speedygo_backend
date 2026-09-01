import { MERCHANT_ERROR_CODES } from '../../merchants/domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { MerchantOrderService } from './merchant-order.service';
import { ORDER_ERROR_CODES } from '../domain/order.errors';
import type { MerchantOrderDetailView } from '../domain/order.types';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const STAFF = '22222222-2222-7222-8222-222222222222';
const MERCHANT = '33333333-3333-7333-8333-333333333333';
const OTHER = '44444444-4444-7444-8444-444444444444';
const ORDER_ID = '55555555-5555-7555-8555-555555555555';
const BRANCH = '66666666-6666-7666-8666-666666666666';

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

function detail(
  overrides: Partial<MerchantOrderDetailView> = {},
): MerchantOrderDetailView {
  return {
    id: ORDER_ID,
    publicReference: 'sgo_abc',
    status: 'CREATED',
    fulfillmentStatus: 'PENDING_ACCEPTANCE',
    merchantBranchId: BRANCH,
    createdAt: '2026-01-15T10:00:00.000Z',
    confirmedAt: null,
    customerFullName: 'Order Customer',
    payment: { method: 'COD', status: 'PENDING' },
    financial: {
      currency: 'DZD',
      grossMerchandiseSubtotalMinor: 1200,
      merchantDiscountMinor: 0,
      merchantCommissionRateBps: 700,
      merchantCommissionAmountMinor: 84,
      merchantNetAmountMinor: 1116,
      deliveryFeeMinor: 500,
    },
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        productNameSnapshot: 'Coffee',
        quantity: 1,
        unitPriceMinor: 1200,
        lineTotalMinor: 1200,
        options: [{ optionNameSnapshot: 'Large', additionalPriceMinor: 200 }],
      },
    ],
    deliveryAddress: {
      addressText: 'Inside zone',
      latitude: 36.75,
      longitude: 3.05,
      instructions: null,
    },
    statusHistory: [
      {
        eventType: 'ORDER_CREATED',
        actorType: 'CUSTOMER',
        fromStatus: null,
        toStatus: 'CREATED',
        occurredAt: '2026-01-15T10:00:00.000Z',
      },
    ],
    cancellation: null,
    ...overrides,
  };
}

describe('MerchantOrderService', () => {
  let access: { requireCapability: jest.Mock };
  let orders: {
    runInTransaction: jest.Mock;
    listBranchIdsForMerchant: jest.Mock;
    findBranchMerchantId: jest.Mock;
    findOrderMerchantId: jest.Mock;
    listMerchantOrders: jest.Mock;
    findMerchantOrderDetail: jest.Mock;
    findMerchantById: jest.Mock;
    findPaymentByOrderId: jest.Mock;
    lockOrder: jest.Mock;
    applyMerchantAccept: jest.Mock;
    applyMerchantReject: jest.Mock;
    applyStartPreparation: jest.Mock;
    applyMarkReady: jest.Mock;
  };
  let service: MerchantOrderService;
  let current: MerchantOrderDetailView;

  beforeEach(() => {
    current = detail();
    access = {
      requireCapability: jest.fn().mockResolvedValue({
        member: { role: 'OWNER' },
        merchant: {
          id: MERCHANT,
          status: 'ACTIVE',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    };
    orders = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      listBranchIdsForMerchant: jest.fn().mockResolvedValue([BRANCH]),
      findBranchMerchantId: jest.fn().mockResolvedValue(MERCHANT),
      findOrderMerchantId: jest.fn().mockResolvedValue(MERCHANT),
      listMerchantOrders: jest.fn().mockResolvedValue({
        items: [current],
        total: 1,
      }),
      findMerchantOrderDetail: jest.fn().mockImplementation(() => current),
      findMerchantById: jest.fn().mockResolvedValue({
        id: MERCHANT,
        status: 'ACTIVE',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      }),
      findPaymentByOrderId: jest.fn().mockResolvedValue({
        method: 'COD',
        status: 'PENDING',
        amountMinor: 1700n,
      }),
      lockOrder: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        customerId: 'cust-1',
        merchantBranchId: BRANCH,
        status: 'CREATED',
        fulfillmentStatus: 'PENDING_ACCEPTANCE',
        publicReference: 'sgo_abc',
        createdAt: '2026-01-15T10:00:00.000Z',
        confirmedAt: null,
        updatedAt: 'lock-1',
      }),
      applyMerchantAccept: jest.fn().mockImplementation(() => {
        current = detail({
          status: 'CONFIRMED',
          fulfillmentStatus: 'ACCEPTED',
          confirmedAt: '2026-01-15T10:01:00.000Z',
          statusHistory: [
            ...current.statusHistory,
            {
              eventType: 'MERCHANT_ACCEPTED',
              actorType: 'MERCHANT',
              fromStatus: 'CREATED',
              toStatus: 'CONFIRMED',
              occurredAt: '2026-01-15T10:01:00.000Z',
            },
          ],
        });
        return true;
      }),
      applyMerchantReject: jest.fn().mockImplementation(() => {
        current = detail({
          status: 'CANCELLED',
          fulfillmentStatus: 'PENDING_ACCEPTANCE',
          payment: { method: 'COD', status: 'CANCELLED' },
          cancellation: {
            reason: 'Out of stock',
            cancelledAt: '2026-01-15T10:02:00.000Z',
          },
          statusHistory: [
            ...current.statusHistory,
            {
              eventType: 'MERCHANT_REJECTED',
              actorType: 'MERCHANT',
              fromStatus: 'CREATED',
              toStatus: 'CANCELLED',
              occurredAt: '2026-01-15T10:02:00.000Z',
            },
          ],
        });
        return 'APPLIED';
      }),
      applyStartPreparation: jest.fn().mockImplementation(() => {
        current = detail({
          ...current,
          status: 'ACTIVE',
          fulfillmentStatus: 'PREPARING',
        });
        return true;
      }),
      applyMarkReady: jest.fn().mockImplementation(() => {
        current = detail({
          ...current,
          fulfillmentStatus: 'READY',
        });
        return true;
      }),
    };
    service = new MerchantOrderService(access as never, orders as never);
  });

  it('lists Orders for an authorized membership without mutating', async () => {
    const listed = await service.listOrders(ACCOUNT, MERCHANT, { limit: 10 });
    expect(listed.total).toBe(1);
    expect(listed.items[0].financial.merchantNetAmountMinor).toBe(1116);
    expect(listed.items[0].financial).not.toHaveProperty(
      'driverRemunerationMinor',
    );
    expect(access.requireCapability).toHaveBeenCalledWith(
      ACCOUNT,
      MERCHANT,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    expect(orders.applyMerchantAccept).not.toHaveBeenCalled();
  });

  it('hides foreign Merchant Orders as not found', async () => {
    orders.findMerchantOrderDetail.mockResolvedValue(null);
    try {
      await service.getOrder(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected hidden');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND);
    }
  });

  it('lets OWNER accept CREATED/PENDING_ACCEPTANCE once', async () => {
    const accepted = await service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID);
    expect(accepted.status).toBe('CONFIRMED');
    expect(accepted.fulfillmentStatus).toBe('ACCEPTED');
    expect(orders.applyMerchantAccept).toHaveBeenCalledTimes(1);
    expect(
      accepted.statusHistory.filter(
        (row) => row.eventType === 'MERCHANT_ACCEPTED',
      ),
    ).toHaveLength(1);
  });

  it('rejects STAFF mutation', async () => {
    access.requireCapability.mockRejectedValue({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    try {
      await service.acceptOrder(STAFF, MERCHANT, ORDER_ID);
      throw new Error('expected staff forbidden');
    } catch (error) {
      expectCode(error, MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
    }
    expect(orders.applyMerchantAccept).not.toHaveBeenCalled();
  });

  it('rejects a second accept without writing another event', async () => {
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-2',
    });
    try {
      await service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected already accepted');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_ALREADY_ACCEPTED);
    }
    expect(orders.applyMerchantAccept).not.toHaveBeenCalled();
  });

  it('rejects start-preparation from PENDING_ACCEPTANCE', async () => {
    try {
      await service.startPreparation(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected invalid');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_INVALID_TRANSITION);
    }
    expect(orders.applyStartPreparation).not.toHaveBeenCalled();
  });

  it('starts preparation only from CONFIRMED/ACCEPTED', async () => {
    current = detail({
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      confirmedAt: '2026-01-15T10:01:00.000Z',
    });
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-3',
    });
    const prepared = await service.startPreparation(
      ACCOUNT,
      MERCHANT,
      ORDER_ID,
    );
    expect(prepared.fulfillmentStatus).toBe('PREPARING');
    expect(prepared.status).toBe('ACTIVE');
  });

  it('rejects mark-ready from ACCEPTED', async () => {
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-4',
    });
    try {
      await service.markReady(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected invalid ready');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_INVALID_TRANSITION);
    }
  });

  it('marks ready from ACTIVE/PREPARING without leaving ACTIVE', async () => {
    current = detail({
      status: 'ACTIVE',
      fulfillmentStatus: 'PREPARING',
      confirmedAt: '2026-01-15T10:01:00.000Z',
    });
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'ACTIVE',
      fulfillmentStatus: 'PREPARING',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-5',
    });
    const ready = await service.markReady(ACCOUNT, MERCHANT, ORDER_ID);
    expect(ready.fulfillmentStatus).toBe('READY');
    expect(ready.status).toBe('ACTIVE');
  });

  it('blocks terminal Orders', async () => {
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CANCELLED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: null,
      updatedAt: 'lock-6',
    });
    try {
      await service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected terminal');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_INVALID_TRANSITION);
    }
  });

  it('does not accept an Order belonging to another Merchant', async () => {
    orders.findOrderMerchantId.mockResolvedValue(OTHER);
    try {
      await service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected foreign');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND);
    }
    expect(orders.lockOrder).not.toHaveBeenCalled();
    expect(orders.applyMerchantAccept).not.toHaveBeenCalled();
  });

  it('blocks mutation when the Merchant is no longer operational', async () => {
    orders.findMerchantById.mockResolvedValue({
      id: MERCHANT,
      status: 'SUSPENDED',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    try {
      await service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected suspended');
    } catch (error) {
      expectCode(error, MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED);
    }
    expect(orders.applyMerchantAccept).not.toHaveBeenCalled();
  });

  it('creates at most one accept transition under concurrency', async () => {
    let accepted = false;
    orders.lockOrder.mockImplementation(() => ({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: accepted ? 'CONFIRMED' : 'CREATED',
      fulfillmentStatus: accepted ? 'ACCEPTED' : 'PENDING_ACCEPTANCE',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: accepted ? '2026-01-15T10:01:00.000Z' : null,
      updatedAt: accepted ? 'lock-b' : 'lock-a',
    }));
    orders.applyMerchantAccept.mockImplementation(() => {
      accepted = true;
      current = detail({
        status: 'CONFIRMED',
        fulfillmentStatus: 'ACCEPTED',
        confirmedAt: '2026-01-15T10:01:00.000Z',
      });
      return true;
    });
    let gate = Promise.resolve();
    orders.runInTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = gate.then(() => fn({}));
        gate = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );
    const [first, second] = await Promise.allSettled([
      service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID),
      service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID),
    ]);
    const successes = [first, second].filter(
      (row) => row.status === 'fulfilled',
    );
    const failures = [first, second].filter((row) => row.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expectCode(
      failures[0].reason,
      ORDER_ERROR_CODES.MERCHANT_ORDER_ALREADY_ACCEPTED,
    );
    expect(orders.applyMerchantAccept).toHaveBeenCalledTimes(1);
  });

  it('lets OWNER reject CREATED/PENDING_ACCEPTANCE and cancel the Payment intent', async () => {
    const rejected = await service.rejectOrder(
      ACCOUNT,
      MERCHANT,
      ORDER_ID,
      'Out of stock',
    );
    expect(rejected.status).toBe('CANCELLED');
    expect(rejected.fulfillmentStatus).toBe('PENDING_ACCEPTANCE');
    expect(rejected.payment.status).toBe('CANCELLED');
    expect(rejected.cancellation?.reason).toBe('Out of stock');
    expect(orders.applyMerchantReject).toHaveBeenCalledTimes(1);
    expect(
      rejected.statusHistory.filter(
        (row) => row.eventType === 'MERCHANT_REJECTED',
      ),
    ).toHaveLength(1);
  });

  it('does not reject an already accepted Order', async () => {
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-7',
    });
    try {
      await service.rejectOrder(ACCOUNT, MERCHANT, ORDER_ID, 'Too late');
      throw new Error('expected not rejectable');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_REJECTABLE);
    }
    expect(orders.applyMerchantReject).not.toHaveBeenCalled();
  });

  it('does not reject when Payment is no longer PENDING', async () => {
    orders.findPaymentByOrderId.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'SUCCEEDED',
      amountMinor: 1700n,
    });
    try {
      await service.rejectOrder(ACCOUNT, MERCHANT, ORDER_ID, 'Paid already');
      throw new Error('expected paid rejection blocked');
    } catch (error) {
      expectCode(
        error,
        ORDER_ERROR_CODES.MERCHANT_ORDER_REJECTION_REQUIRES_CANCELLATION_FLOW,
      );
    }
    expect(orders.applyMerchantReject).not.toHaveBeenCalled();
  });

  it('blocks ELECTRONIC start-preparation while Payment is PENDING', async () => {
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-8',
    });
    orders.findPaymentByOrderId.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'PENDING',
      amountMinor: 1700n,
    });
    try {
      await service.startPreparation(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected payment gate');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_PAYMENT_NOT_READY);
    }
    expect(orders.applyStartPreparation).not.toHaveBeenCalled();
  });

  it('allows ELECTRONIC start-preparation after Payment SUCCEEDED', async () => {
    current = detail({
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      payment: { method: 'ELECTRONIC', status: 'SUCCEEDED' },
    });
    orders.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: '2026-01-15T10:01:00.000Z',
      updatedAt: 'lock-9',
    });
    orders.findPaymentByOrderId.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'SUCCEEDED',
      amountMinor: 1700n,
    });
    const prepared = await service.startPreparation(
      ACCOUNT,
      MERCHANT,
      ORDER_ID,
    );
    expect(prepared.status).toBe('ACTIVE');
    expect(prepared.fulfillmentStatus).toBe('PREPARING');
  });

  it('serializes concurrent accept vs reject to one winner', async () => {
    let decided: 'accept' | 'reject' | null = null;
    orders.lockOrder.mockImplementation(() => ({
      id: ORDER_ID,
      customerId: 'cust-1',
      merchantBranchId: BRANCH,
      status:
        decided === 'accept'
          ? 'CONFIRMED'
          : decided === 'reject'
            ? 'CANCELLED'
            : 'CREATED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
      publicReference: 'sgo_abc',
      createdAt: '2026-01-15T10:00:00.000Z',
      confirmedAt: decided === 'accept' ? '2026-01-15T10:01:00.000Z' : null,
      updatedAt: decided ? 'lock-b' : 'lock-a',
    }));
    orders.applyMerchantAccept.mockImplementation(() => {
      decided = 'accept';
      current = detail({
        status: 'CONFIRMED',
        fulfillmentStatus: 'ACCEPTED',
        confirmedAt: '2026-01-15T10:01:00.000Z',
      });
      return true;
    });
    orders.applyMerchantReject.mockImplementation(() => {
      decided = 'reject';
      current = detail({
        status: 'CANCELLED',
        fulfillmentStatus: 'PENDING_ACCEPTANCE',
        payment: { method: 'COD', status: 'CANCELLED' },
      });
      return 'APPLIED';
    });
    let gate = Promise.resolve();
    orders.runInTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = gate.then(() => fn({}));
        gate = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );
    const [first, second] = await Promise.allSettled([
      service.acceptOrder(ACCOUNT, MERCHANT, ORDER_ID),
      service.rejectOrder(ACCOUNT, MERCHANT, ORDER_ID, 'Busy'),
    ]);
    const successes = [first, second].filter(
      (row) => row.status === 'fulfilled',
    );
    const failures = [first, second].filter((row) => row.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const appliedAccept = orders.applyMerchantAccept.mock.calls.length;
    const appliedReject = orders.applyMerchantReject.mock.calls.length;
    expect(appliedAccept + appliedReject).toBe(1);
  });
});
