import { ConfigService } from '@nestjs/config';
import { TrackingService } from './tracking.service';
import { TRACKING_ERROR_CODES } from '../domain/tracking.errors';

const DRIVER_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ORDER_ID = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';
const CUSTOMER_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const MERCHANT_ID = 'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm';

describe('TrackingService', () => {
  let locations: {
    upsertIfNewer: jest.Mock;
    get: jest.Mock;
  };
  let drivers: {
    findProfileByAccountId: jest.Mock;
    findAvailability: jest.Mock;
    findOpenAcceptedAssignment: jest.Mock;
  };
  let deliveries: {
    getCustomerDelivery: jest.Mock;
    getMerchantDelivery: jest.Mock;
  };
  let deliveryRows: {
    findDeliveryById: jest.Mock;
    findProfileIdByAccountId: jest.Mock;
    findOrderRecord: jest.Mock;
    findBranchMerchantId: jest.Mock;
  };
  let redisSet: jest.Mock;
  let service: TrackingService;

  beforeEach(() => {
    locations = {
      upsertIfNewer: jest.fn().mockResolvedValue({
        record: {
          driverId: DRIVER_ID,
          latitude: 36.75,
          longitude: 3.05,
          recordedAt: '2026-09-02T00:00:00.000Z',
        },
        applied: true,
      }),
      get: jest.fn().mockResolvedValue({
        driverId: DRIVER_ID,
        latitude: 36.75,
        longitude: 3.05,
        recordedAt: new Date().toISOString(),
      }),
    };
    drivers = {
      findProfileByAccountId: jest.fn().mockResolvedValue({
        id: DRIVER_ID,
        accountId: ACCOUNT,
        verificationStatus: 'APPROVED',
      }),
      findAvailability: jest.fn().mockResolvedValue({ status: 'ONLINE' }),
      findOpenAcceptedAssignment: jest.fn().mockResolvedValue(null),
    };
    deliveries = {
      getCustomerDelivery: jest.fn(),
      getMerchantDelivery: jest.fn(),
    };
    deliveryRows = {
      findDeliveryById: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        orderId: ORDER_ID,
        status: 'DRIVER_ASSIGNED',
      }),
      findProfileIdByAccountId: jest.fn().mockResolvedValue(CUSTOMER_ID),
      findOrderRecord: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        customerId: CUSTOMER_ID,
        merchantBranchId: 'branch-1',
      }),
      findBranchMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    };
    redisSet = jest.fn().mockResolvedValue('OK');
    service = new TrackingService(
      locations as never,
      drivers as never,
      deliveries as never,
      deliveryRows as never,
      { getClient: () => ({ set: redisSet }) } as never,
      {
        get: (key: string, fallback: number | string) => {
          if (key === 'matching.locationMaxAgeMs') {
            return 45_000;
          }
          if (key === 'tracking.minUpdateIntervalMs') {
            return 1000;
          }
          if (key === 'tracking.redisKeyPrefix') {
            return 'tracking:test:';
          }
          return fallback;
        },
      } as unknown as ConfigService,
    );
  });

  it('stores an ONLINE unassigned location without broadcasting', async () => {
    const result = await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(result.broadcast).toBe(false);
    expect(result.deliveryId).toBeNull();
    expect(result.rooms).toEqual([]);
    expect(locations.upsertIfNewer).toHaveBeenCalled();
  });

  it('ignores payload identity fields and uses the authenticated Driver', async () => {
    await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
      driverId: 'injected',
    } as never);
    const firstCall = locations.upsertIfNewer.mock.calls[0] as unknown[];
    expect(firstCall[0]).toBe(DRIVER_ID);
  });

  it('broadcasts only to actor-scoped rooms when an ACCEPTED assignment exists', async () => {
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    const result = await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(result.broadcast).toBe(true);
    expect(result.deliveryId).toBe(DELIVERY_ID);
    expect(result.rooms).toEqual([
      `tracking:delivery:${DELIVERY_ID}:customer:${CUSTOMER_ID}`,
      `tracking:delivery:${DELIVERY_ID}:driver:${DRIVER_ID}`,
      `tracking:delivery:${DELIVERY_ID}:merchant:${MERCHANT_ID}`,
    ]);
  });

  it('rejects OFFLINE Drivers without an accepted assignment', async () => {
    drivers.findAvailability.mockResolvedValue({ status: 'OFFLINE' });
    await expect(
      service.publishDriverLocation(ACCOUNT, {
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_NOT_ALLOWED,
    });
  });

  it('rejects SUSPENDED Drivers even when rate-limited', async () => {
    redisSet.mockResolvedValue(null);
    drivers.findProfileByAccountId.mockResolvedValue({
      id: DRIVER_ID,
      verificationStatus: 'SUSPENDED',
    });
    drivers.findAvailability.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(
      service.publishDriverLocation(ACCOUNT, {
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_NOT_ALLOWED,
    });
    expect(locations.upsertIfNewer).not.toHaveBeenCalled();
  });

  it('rejects missing DriverProfile', async () => {
    drivers.findProfileByAccountId.mockResolvedValue(null);
    await expect(
      service.publishDriverLocation(ACCOUNT, {
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_NOT_ALLOWED,
    });
  });

  it('rate-limits rapid updates', async () => {
    redisSet.mockResolvedValue(null);
    await expect(
      service.publishDriverLocation(ACCOUNT, {
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_RATE_LIMITED,
    });
  });

  it('fails ingest with a store error instead of UNAVAILABLE', async () => {
    locations.upsertIfNewer.mockRejectedValue(new Error('redis down'));
    await expect(
      service.publishDriverLocation(ACCOUNT, {
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_STORE_UNAVAILABLE,
    });
  });

  it('returns NO_DRIVER for an owned Delivery without an accepted assignment', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'SEARCHING_DRIVER',
      assignedDriverId: null,
    });
    const snapshot = await service.snapshotForCustomer(ACCOUNT, ORDER_ID);
    expect(snapshot.status).toBe('NO_DRIVER');
    expect(snapshot.location).toBeNull();
    expect(snapshot.driverAssigned).toBe(false);
  });

  it('returns UNAVAILABLE when accepted but no current location exists', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'DRIVER_ASSIGNED',
      assignedDriverId: DRIVER_ID,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    locations.get.mockResolvedValue(null);
    const snapshot = await service.snapshotForCustomer(ACCOUNT, ORDER_ID);
    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.driverAssigned).toBe(true);
    expect(snapshot.location).toBeNull();
  });

  it('returns UNAVAILABLE when assignment is accepted but Delivery is not trackable', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'CANCELLED',
      assignedDriverId: DRIVER_ID,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    const snapshot = await service.snapshotForCustomer(ACCOUNT, ORDER_ID);
    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.driverAssigned).toBe(true);
    expect(snapshot.location).toBeNull();
  });

  it('fails bootstrap with a store error instead of UNAVAILABLE', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'DRIVER_ASSIGNED',
      assignedDriverId: DRIVER_ID,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    locations.get.mockRejectedValue(new Error('redis down'));
    await expect(
      service.snapshotForCustomer(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: TRACKING_ERROR_CODES.DRIVER_LOCATION_STORE_UNAVAILABLE,
    });
  });

  it('omits stale coordinates from live location', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'DRIVER_ASSIGNED',
      assignedDriverId: DRIVER_ID,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    locations.get.mockResolvedValue({
      driverId: DRIVER_ID,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2020-01-01T00:00:00.000Z',
    });
    const snapshot = await service.snapshotForCustomer(ACCOUNT, ORDER_ID);
    expect(snapshot.status).toBe('STALE');
    expect(snapshot.isStale).toBe(true);
    expect(snapshot.location).toBeNull();
    expect(snapshot.driverAssigned).toBe(true);
  });

  it('still broadcasts while Delivery is TO_PICKUP on an accepted assignment', async () => {
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    deliveryRows.findDeliveryById.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'TO_PICKUP',
    });
    const result = await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(result.broadcast).toBe(true);
    expect(result.deliveryId).toBe(DELIVERY_ID);
  });

  it('stops broadcast after the accepted assignment is released', async () => {
    drivers.findOpenAcceptedAssignment.mockResolvedValue(null);
    const result = await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(result.broadcast).toBe(false);
    expect(result.deliveryId).toBeNull();
  });

  it('returns NO_DRIVER after Delivery is DELIVERED and assignment is gone', async () => {
    deliveries.getCustomerDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'DELIVERED',
      assignedDriverId: null,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue(null);
    const snapshot = await service.snapshotForCustomer(ACCOUNT, ORDER_ID);
    expect(snapshot.status).toBe('NO_DRIVER');
    expect(snapshot.driverAssigned).toBe(false);
    expect(snapshot.location).toBeNull();
  });

  it('authorizes Merchant ORDER_READ snapshots as LIVE', async () => {
    deliveries.getMerchantDelivery.mockResolvedValue({
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      status: 'DRIVER_ASSIGNED',
      assignedDriverId: DRIVER_ID,
    });
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: 'asg-1',
      deliveryId: DELIVERY_ID,
      status: 'ACCEPTED',
    });
    const snapshot = await service.snapshotForMerchant(
      ACCOUNT,
      MERCHANT_ID,
      ORDER_ID,
    );
    expect(snapshot.status).toBe('LIVE');
    expect(snapshot.location?.assignedDriverId).toBe(DRIVER_ID);
    expect(JSON.stringify(snapshot)).not.toContain('phone');
  });

  it('renews freshness for a stationary update after the rate-limit interval', async () => {
    redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce('OK');
    await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    await service.publishDriverLocation(ACCOUNT, {
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(locations.upsertIfNewer).toHaveBeenCalledTimes(2);
  });
});
