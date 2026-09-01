import { MERCHANT_ERROR_CODES } from '../../merchants/domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { ORDER_ERROR_CODES } from '../../orders/domain/order.errors';
import { DeliveryService } from './delivery.service';
import { DELIVERY_ERROR_CODES } from '../domain/delivery.errors';
import type { DeliveryDetailView } from '../domain/delivery.types';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const OTHER = '22222222-2222-7222-8222-222222222222';
const MERCHANT = '33333333-3333-7333-8333-333333333333';
const OTHER_MERCHANT = '44444444-4444-7444-8444-444444444444';
const ORDER_ID = '55555555-5555-7555-8555-555555555555';
const BRANCH = '66666666-6666-7666-8666-666666666666';
const CUSTOMER = '77777777-7777-7777-8777-777777777777';

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

function detail(
  overrides: Partial<DeliveryDetailView> = {},
): DeliveryDetailView {
  return {
    id: 'delivery-1',
    orderId: ORDER_ID,
    publicReference: 'sgo_abc',
    status: 'SEARCHING_DRIVER',
    orderStatus: 'ACTIVE',
    fulfillmentStatus: 'READY',
    assignedDriverId: null,
    driverSearchStartedAt: '2026-01-15T12:00:00.000Z',
    pickedUpAt: null,
    estimatedArrivalAt: null,
    arrivedCustomerAt: null,
    deliveredAt: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    pickup: {
      merchantBranchId: BRANCH,
      name: 'Main',
      addressText: 'Street A',
      latitude: 36.75,
      longitude: 3.05,
      phone: '0550123499',
    },
    dropoff: {
      addressText: 'Inside zone',
      latitude: 36.75,
      longitude: 3.05,
      instructions: null,
    },
    deliveryFeeMinor: 500,
    events: [
      {
        type: 'DELIVERY_CREATED',
        occurredAt: '2026-01-15T12:00:00.000Z',
        driverId: null,
      },
    ],
    ...overrides,
  };
}

describe('DeliveryService', () => {
  let access: { requireCapability: jest.Mock };
  let deliveries: {
    runInTransaction: jest.Mock;
    lockOrder: jest.Mock;
    lockPayment: jest.Mock;
    findAddressSnapshot: jest.Mock;
    findDeliveryIdByOrderId: jest.Mock;
    insertDeliveryWithCreatedEvent: jest.Mock;
    findDeliveryDetail: jest.Mock;
    findProfileIdByAccountId: jest.Mock;
    findOrderRecord: jest.Mock;
    findBranchMerchantId: jest.Mock;
  };
  let service: DeliveryService;
  let current: DeliveryDetailView | null;

  beforeEach(() => {
    current = null;
    access = {
      requireCapability: jest.fn().mockResolvedValue({
        member: { role: 'OWNER' },
      }),
    };
    deliveries = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockOrder: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        customerId: CUSTOMER,
        merchantBranchId: BRANCH,
        status: 'ACTIVE',
        fulfillmentStatus: 'READY',
        publicReference: 'sgo_abc',
        updatedAt: 'lock-1',
      }),
      lockPayment: jest.fn().mockResolvedValue({
        method: 'COD',
        status: 'PENDING',
      }),
      findAddressSnapshot: jest.fn().mockResolvedValue(true),
      findDeliveryIdByOrderId: jest.fn().mockResolvedValue(null),
      insertDeliveryWithCreatedEvent: jest.fn().mockImplementation(() => {
        current = detail();
        return 'delivery-1';
      }),
      findDeliveryDetail: jest.fn().mockImplementation(() => current),
      findProfileIdByAccountId: jest.fn().mockResolvedValue(CUSTOMER),
      findOrderRecord: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        customerId: CUSTOMER,
        merchantBranchId: BRANCH,
        status: 'ACTIVE',
        fulfillmentStatus: 'READY',
        publicReference: 'sgo_abc',
      }),
      findBranchMerchantId: jest.fn().mockResolvedValue(MERCHANT),
    };
    service = new DeliveryService(deliveries as never, access as never);
  });

  it('creates Delivery for ACTIVE + READY COD PENDING without assigning a Driver', async () => {
    const created = await service.createForReadyOrder(ORDER_ID);
    expect(created.status).toBe('SEARCHING_DRIVER');
    expect(created.driverSearchStartedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(created.assignedDriverId).toBeNull();
    expect(created.orderStatus).toBe('ACTIVE');
    expect(created.fulfillmentStatus).toBe('READY');
    expect(created.events).toHaveLength(1);
    expect(created.events[0].type).toBe('DELIVERY_CREATED');
    expect(created.events[0].driverId).toBeNull();
    expect(deliveries.insertDeliveryWithCreatedEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CREATED', 'PENDING_ACCEPTANCE'],
    ['CONFIRMED', 'ACCEPTED'],
    ['ACTIVE', 'PREPARING'],
    ['CANCELLED', 'PENDING_ACCEPTANCE'],
    ['FAILED', 'READY'],
    ['COMPLETED', 'READY'],
  ])('rejects Order %s / %s', async (status, fulfillmentStatus) => {
    deliveries.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: CUSTOMER,
      merchantBranchId: BRANCH,
      status,
      fulfillmentStatus,
      publicReference: 'sgo_abc',
      updatedAt: 'lock-1',
    });
    try {
      await service.createForReadyOrder(ORDER_ID);
      throw new Error('expected ineligible');
    } catch (error) {
      expectCode(error, DELIVERY_ERROR_CODES.DELIVERY_ORDER_NOT_ELIGIBLE);
    }
    expect(deliveries.insertDeliveryWithCreatedEvent).not.toHaveBeenCalled();
  });

  it('returns the existing Delivery without a second event or timestamp rewrite', async () => {
    current = detail({ driverSearchStartedAt: '2026-01-15T12:00:00.000Z' });
    deliveries.findDeliveryIdByOrderId.mockResolvedValue('delivery-1');
    const existing = await service.createForReadyOrder(ORDER_ID);
    expect(existing.id).toBe('delivery-1');
    expect(existing.driverSearchStartedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(existing.events).toHaveLength(1);
    expect(deliveries.insertDeliveryWithCreatedEvent).not.toHaveBeenCalled();
    expect(deliveries.lockPayment).not.toHaveBeenCalled();
  });

  it('returns the existing Delivery even if Order is no longer READY', async () => {
    current = detail({ driverSearchStartedAt: '2026-01-15T12:00:00.000Z' });
    deliveries.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: CUSTOMER,
      merchantBranchId: BRANCH,
      status: 'CANCELLED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
      publicReference: 'sgo_abc',
      updatedAt: 'lock-1',
    });
    deliveries.findDeliveryIdByOrderId.mockResolvedValue('delivery-1');
    const existing = await service.createForReadyOrder(ORDER_ID);
    expect(existing.id).toBe('delivery-1');
    expect(existing.driverSearchStartedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(deliveries.insertDeliveryWithCreatedEvent).not.toHaveBeenCalled();
    expect(deliveries.lockPayment).not.toHaveBeenCalled();
  });

  it('blocks ELECTRONIC Payment that is not SUCCEEDED', async () => {
    deliveries.lockPayment.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'PENDING',
    });
    try {
      await service.createForReadyOrder(ORDER_ID);
      throw new Error('expected payment');
    } catch (error) {
      expectCode(error, DELIVERY_ERROR_CODES.DELIVERY_PAYMENT_NOT_READY);
    }
    deliveries.lockPayment.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'FAILED',
    });
    await expect(service.createForReadyOrder(ORDER_ID)).rejects.toMatchObject({
      code: DELIVERY_ERROR_CODES.DELIVERY_PAYMENT_NOT_READY,
    });
    deliveries.lockPayment.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'CANCELLED',
    });
    await expect(service.createForReadyOrder(ORDER_ID)).rejects.toMatchObject({
      code: DELIVERY_ERROR_CODES.DELIVERY_PAYMENT_NOT_READY,
    });
    expect(deliveries.insertDeliveryWithCreatedEvent).not.toHaveBeenCalled();
  });

  it('allows ELECTRONIC Payment SUCCEEDED', async () => {
    deliveries.lockPayment.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'SUCCEEDED',
    });
    const created = await service.createForReadyOrder(ORDER_ID);
    expect(created.status).toBe('SEARCHING_DRIVER');
  });

  it('creates at most one Delivery under concurrent create', async () => {
    let created = false;
    deliveries.findDeliveryIdByOrderId.mockImplementation(() =>
      created ? 'delivery-1' : null,
    );
    deliveries.insertDeliveryWithCreatedEvent.mockImplementation(() => {
      created = true;
      current = detail();
      return 'delivery-1';
    });
    let gate = Promise.resolve();
    deliveries.runInTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = gate.then(() => fn({}));
        gate = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );
    const [first, second] = await Promise.all([
      service.createForReadyOrder(ORDER_ID),
      service.createForReadyOrder(ORDER_ID),
    ]);
    expect(first.id).toBe(second.id);
    expect(deliveries.insertDeliveryWithCreatedEvent).toHaveBeenCalledTimes(1);
    expect(first.driverSearchStartedAt).toBe(second.driverSearchStartedAt);
  });

  it('hides foreign Customer Delivery as Order not found', async () => {
    current = detail();
    deliveries.findOrderRecord.mockResolvedValue({
      id: ORDER_ID,
      customerId: 'other-customer',
      merchantBranchId: BRANCH,
      status: 'ACTIVE',
      fulfillmentStatus: 'READY',
      publicReference: 'sgo_abc',
    });
    try {
      await service.getCustomerDelivery(ACCOUNT, ORDER_ID);
      throw new Error('expected hidden');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_NOT_FOUND);
    }
  });

  it('returns DELIVERY_NOT_FOUND for an owned Order with no Delivery', async () => {
    try {
      await service.getCustomerDelivery(ACCOUNT, ORDER_ID);
      throw new Error('expected missing delivery');
    } catch (error) {
      expectCode(error, DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND);
    }
  });

  it('omits Branch phone from Customer Delivery reads', async () => {
    current = detail();
    const read = await service.getCustomerDelivery(ACCOUNT, ORDER_ID);
    expect(read.status).toBe('SEARCHING_DRIVER');
    expect(read.assignedDriverId).toBeNull();
    expect(read.pickup).not.toHaveProperty('phone');
    expect(read.deliveryFeeMinor).toBe(500);
    expect(read).not.toHaveProperty('driverRemunerationMinor');
  });

  it('hides foreign Merchant Delivery as not found', async () => {
    current = detail();
    deliveries.findBranchMerchantId.mockResolvedValue(OTHER_MERCHANT);
    try {
      await service.getMerchantDelivery(ACCOUNT, MERCHANT, ORDER_ID);
      throw new Error('expected hidden merchant');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND);
    }
  });

  it('lets STAFF read and omits Merchant-facing Delivery Fee from Merchant DTO', async () => {
    current = detail();
    const read = await service.getMerchantDelivery(ACCOUNT, MERCHANT, ORDER_ID);
    expect(read.pickup.phone).toBe('0550123499');
    expect(read.status).toBe('SEARCHING_DRIVER');
    expect(read.assignedDriverId).toBeNull();
    expect(read).not.toHaveProperty('deliveryFeeMinor');
    expect(read).not.toHaveProperty('driverRemunerationMinor');
    expect(access.requireCapability).toHaveBeenCalledWith(
      ACCOUNT,
      MERCHANT,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
  });

  it('lets SUSPENDED Merchant membership read SEARCHING_DRIVER before Driver assignment', async () => {
    current = detail();
    access.requireCapability.mockResolvedValue({
      member: { role: 'STAFF' },
      merchant: { status: 'SUSPENDED' },
    });
    const read = await service.getMerchantDelivery(ACCOUNT, MERCHANT, ORDER_ID);
    expect(read.status).toBe('SEARCHING_DRIVER');
    expect(read.assignedDriverId).toBeNull();
    expect(access.requireCapability).toHaveBeenCalledWith(
      ACCOUNT,
      MERCHANT,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
  });

  it('does not accept injected Driver or status on create', () => {
    expect(service.createForReadyOrder.length).toBe(1);
  });

  it('returns the committed Delivery if unique orderId races', async () => {
    current = detail();
    deliveries.runInTransaction.mockRejectedValue({ code: '23505' });
    const existing = await service.createForReadyOrder(ORDER_ID);
    expect(existing.id).toBe('delivery-1');
    expect(existing.events).toHaveLength(1);
  });

  it('rejects STAFF-unrelated capability failures from Merchant access', async () => {
    access.requireCapability.mockRejectedValue({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    try {
      await service.getMerchantDelivery(OTHER, MERCHANT, ORDER_ID);
      throw new Error('expected forbidden');
    } catch (error) {
      expectCode(error, MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN);
    }
  });
});
