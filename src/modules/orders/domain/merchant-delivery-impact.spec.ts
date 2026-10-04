import {
  deriveMerchantDeliveryImpact,
  derivePreparationDelayMinutes,
  type DeliveryImpactInput,
} from './merchant-delivery-impact';

function impact(overrides: Partial<DeliveryImpactInput> = {}) {
  return deriveMerchantDeliveryImpact({
    isPreparationLate: false,
    fulfillmentStatus: 'PREPARING',
    orderStatus: 'ACTIVE',
    deliveryStatus: null,
    ...overrides,
  });
}

describe('deriveMerchantDeliveryImpact', () => {
  it.each(['CANCELLED', 'FAILED', 'COMPLETED'])(
    'is RESOLVED for terminal order status %s',
    (orderStatus) => {
      expect(impact({ orderStatus, isPreparationLate: true })).toBe('RESOLVED');
    },
  );

  it.each(['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_CUSTOMER', 'DELIVERED'])(
    'is RESOLVED once Delivery is %s',
    (deliveryStatus) => {
      expect(impact({ deliveryStatus, isPreparationLate: true })).toBe(
        'RESOLVED',
      );
    },
  );

  it('is DRIVER_WAITING at pickup', () => {
    expect(impact({ deliveryStatus: 'AT_PICKUP' })).toBe('DRIVER_WAITING');
  });

  it.each(['DRIVER_ASSIGNED', 'TO_PICKUP'])(
    'may delay pickup when %s and prep is not ready',
    (deliveryStatus) => {
      expect(impact({ deliveryStatus })).toBe('MAY_DELAY_PICKUP');
      expect(
        impact({
          deliveryStatus,
          fulfillmentStatus: 'READY',
          isPreparationLate: true,
        }),
      ).toBe('MAY_DELAY_PICKUP');
    },
  );

  it('resolves an assigned driver when prep is READY and not late', () => {
    expect(
      impact({ deliveryStatus: 'TO_PICKUP', fulfillmentStatus: 'READY' }),
    ).toBe('RESOLVED');
  });

  it('may delay driver assignment while searching', () => {
    expect(impact({ deliveryStatus: 'SEARCHING_DRIVER' })).toBe(
      'MAY_DELAY_DRIVER_ASSIGNMENT',
    );
  });

  it.each(['FAILED', 'CANCELLED'])(
    'cannot state timing for a %s Delivery',
    (deliveryStatus) => {
      expect(impact({ deliveryStatus })).toBe('DELIVERY_TIMING_UNAVAILABLE');
    },
  );

  it.each(['ACCEPTED', 'PREPARING'])(
    'without Delivery while %s: unavailable on time, may delay when late',
    (fulfillmentStatus) => {
      expect(impact({ fulfillmentStatus })).toBe('DELIVERY_TIMING_UNAVAILABLE');
      expect(impact({ fulfillmentStatus, isPreparationLate: true })).toBe(
        'MAY_DELAY_DRIVER_ASSIGNMENT',
      );
    },
  );

  it('may delay driver assignment when READY with no Delivery yet', () => {
    expect(impact({ fulfillmentStatus: 'READY' })).toBe(
      'MAY_DELAY_DRIVER_ASSIGNMENT',
    );
  });

  it('is case-insensitive and falls back to unavailable', () => {
    expect(
      impact({ deliveryStatus: 'at_pickup', fulfillmentStatus: 'preparing' }),
    ).toBe('DRIVER_WAITING');
    expect(impact({ fulfillmentStatus: 'PENDING_ACCEPTANCE' })).toBe(
      'DELIVERY_TIMING_UNAVAILABLE',
    );
  });
});

describe('derivePreparationDelayMinutes', () => {
  const asOf = new Date('2026-10-04T10:00:00.000Z');

  it('floors whole minutes when late', () => {
    expect(
      derivePreparationDelayMinutes(true, '2026-10-04T09:46:30.000Z', asOf),
    ).toBe(13);
    expect(
      derivePreparationDelayMinutes(
        true,
        new Date('2026-10-04T09:50:00.000Z'),
        asOf,
      ),
    ).toBe(10);
  });

  it('is null when not late, without estimate, or not yet overdue', () => {
    expect(
      derivePreparationDelayMinutes(false, '2026-10-04T09:00:00.000Z', asOf),
    ).toBeNull();
    expect(derivePreparationDelayMinutes(true, null, asOf)).toBeNull();
    expect(derivePreparationDelayMinutes(true, undefined, asOf)).toBeNull();
    expect(
      derivePreparationDelayMinutes(true, '2026-10-04T10:00:00.000Z', asOf),
    ).toBeNull();
    expect(
      derivePreparationDelayMinutes(true, '2026-10-04T10:05:00.000Z', asOf),
    ).toBeNull();
  });

  it('is null for an unparseable estimate', () => {
    expect(derivePreparationDelayMinutes(true, 'not-a-date', asOf)).toBeNull();
  });
});
