import {
  assertHistoryEarningOwnership,
  assertHistoryPrivacyKeys,
  HISTORY_FORBIDDEN_RESPONSE_KEYS,
  isCompletedHistoryDelivery,
  isCompletedHistoryMembership,
  isCompletedHistoryServingAssignment,
  mapHistoryPublicFields,
  normalizeDriverDeliveryHistoryListQuery,
  parseHistoryInstant,
  validateHistoryDeliveredAtWindow,
} from './driver-delivery-history.policy';
import { DRIVER_DELIVERY_HISTORY_ERROR_CODES } from './driver-delivery-history.errors';

function expectHistoryError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected throw');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('driver-delivery-history.policy', () => {
  const deliveryId = 'd1';
  const driverA = 'drv-a';
  const driverB = 'drv-b';

  describe('isCompletedHistoryDelivery', () => {
    it('requires DELIVERED and non-null deliveredAt', () => {
      expect(
        isCompletedHistoryDelivery({
          status: 'DELIVERED',
          deliveredAt: '2026-01-01T00:00:00.000Z',
        }),
      ).toBe(true);
      expect(
        isCompletedHistoryDelivery({
          status: 'IN_TRANSIT',
          deliveredAt: '2026-01-01T00:00:00.000Z',
        }),
      ).toBe(false);
      expect(
        isCompletedHistoryDelivery({
          status: 'DELIVERED',
          deliveredAt: null,
        }),
      ).toBe(false);
    });
  });

  describe('membership conjunction', () => {
    const delivered = {
      status: 'DELIVERED',
      deliveredAt: '2026-01-01T12:00:00.000Z',
    };
    const releasedB = {
      status: 'RELEASED',
      acceptedAt: '2026-01-01T10:00:00.000Z',
      releasedAt: '2026-01-01T12:00:00.000Z',
      driverId: driverB,
      deliveryId,
    };
    const earningB = { deliveryId, driverId: driverB };

    it('accepts completing Driver with RELEASED + matching earning', () => {
      expect(
        isCompletedHistoryMembership({
          delivery: delivered,
          assignment: releasedB,
          earning: earningB,
          authenticatedDriverId: driverB,
        }),
      ).toBe(true);
    });

    it('rejects RELEASED alone without earning', () => {
      expect(
        isCompletedHistoryMembership({
          delivery: delivered,
          assignment: {
            status: 'RELEASED',
            acceptedAt: '2026-01-01T09:00:00.000Z',
            releasedAt: '2026-01-01T09:30:00.000Z',
            driverId: driverA,
            deliveryId,
          },
          earning: null,
          authenticatedDriverId: driverA,
        }),
      ).toBe(false);
    });

    it('rejects accepted-then-released non-serving Driver when earning belongs to completer', () => {
      expect(
        isCompletedHistoryMembership({
          delivery: delivered,
          assignment: {
            status: 'RELEASED',
            acceptedAt: '2026-01-01T09:00:00.000Z',
            releasedAt: '2026-01-01T09:30:00.000Z',
            driverId: driverA,
            deliveryId,
          },
          earning: earningB,
          authenticatedDriverId: driverA,
        }),
      ).toBe(false);
    });

    it('rejects contradictory earning for authenticated Driver', () => {
      expect(
        isCompletedHistoryMembership({
          delivery: delivered,
          assignment: {
            status: 'RELEASED',
            acceptedAt: '2026-01-01T09:00:00.000Z',
            releasedAt: '2026-01-01T12:00:00.000Z',
            driverId: driverA,
            deliveryId,
          },
          earning: earningB,
          authenticatedDriverId: driverA,
        }),
      ).toBe(false);
    });

    it('rejects OFFERED REJECTED EXPIRED and open ACCEPTED', () => {
      for (const status of ['OFFERED', 'REJECTED', 'EXPIRED', 'ACCEPTED']) {
        expect(
          isCompletedHistoryServingAssignment({
            status,
            acceptedAt:
              status === 'ACCEPTED' || status === 'REJECTED'
                ? '2026-01-01T00:00:00.000Z'
                : null,
            releasedAt:
              status === 'REJECTED' || status === 'EXPIRED'
                ? '2026-01-01T00:01:00.000Z'
                : null,
            driverId: driverB,
            expectedDriverId: driverB,
          }),
        ).toBe(false);
      }
    });
  });

  describe('assertHistoryEarningOwnership', () => {
    it('fails closed when earning missing or wrong Driver', () => {
      expectHistoryError(
        () =>
          assertHistoryEarningOwnership({
            earning: null,
            deliveryId,
            servingDriverId: driverB,
          }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
      );
      expectHistoryError(
        () =>
          assertHistoryEarningOwnership({
            earning: {
              deliveryId,
              driverId: driverA,
              status: 'EARNED',
            },
            deliveryId,
            servingDriverId: driverB,
          }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
      );
    });
  });

  describe('pagination and date window', () => {
    it('bounds limit/offset and rejects bare dates', () => {
      expect(
        normalizeDriverDeliveryHistoryListQuery({ limit: 10, offset: 0 }),
      ).toEqual({ limit: 10, offset: 0 });
      expectHistoryError(
        () => normalizeDriverDeliveryHistoryListQuery({ limit: 101 }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_QUERY_INVALID,
      );
      expectHistoryError(
        () =>
          normalizeDriverDeliveryHistoryListQuery({
            limit: 10,
            offset: 10_001,
          }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_QUERY_INVALID,
      );
      expect(parseHistoryInstant('2026-01-01')).toBeNull();
      expectHistoryError(
        () => validateHistoryDeliveredAtWindow('2026-01-01', '2026-01-02'),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_QUERY_INVALID,
      );
    });
  });

  describe('privacy mapper and forbidden keys', () => {
    it('omits internal IDs and forbidden privacy keys', () => {
      const mapped = mapHistoryPublicFields({
        deliveryId,
        orderPublicReference: 'sgo_1',
        deliveryStatus: 'DELIVERED',
        deliveredAt: '2026-01-01T00:00:00.000Z',
        merchantName: 'Cafe',
        branchName: 'Main',
        paymentMethod: 'COD',
        pickedUpAt: null,
        arrivedCustomerAt: null,
        earningId: 'e1',
        earningAmountMinor: '9007199254740993',
        earningStatus: 'EARNED',
        earnedAt: '2026-01-01T00:00:00.000Z',
        currency: 'DZD',
      });
      expect(mapped.list.earning.earningAmountMinor).toBe('9007199254740993');
      expect(mapped.detailExtras).not.toHaveProperty('orderId');
      expect(mapped.detailExtras).not.toHaveProperty('assignmentId');
      const payload = { ...mapped.list, ...mapped.detailExtras };
      assertHistoryPrivacyKeys(payload);
      for (const key of HISTORY_FORBIDDEN_RESPONSE_KEYS) {
        expect(payload).not.toHaveProperty(key);
      }
    });

    it('fails closed when forbidden keys appear', () => {
      expectHistoryError(
        () => assertHistoryPrivacyKeys({ orderId: 'x' }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
      );
      expectHistoryError(
        () => assertHistoryPrivacyKeys({ assignmentId: 'x' }),
        DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
      );
    });
  });
});
