import { ConfigService } from '@nestjs/config';
import { DELIVERY_STATUS_SEARCHING_DRIVER } from '../../delivery/domain/delivery.policy';
import { MatchingService } from './matching.service';
import { MATCHING_ERROR_CODES } from '../domain/matching.errors';
import {
  ASSIGNMENT_STATUS_ACCEPTED,
  ASSIGNMENT_STATUS_EXPIRED,
  ASSIGNMENT_STATUS_OFFERED,
  ASSIGNMENT_STATUS_REJECTED,
} from '../domain/matching.policy';
import type {
  AssignmentRecord,
  DriverLocationRecord,
  DriverLocationStore,
  GeoCandidate,
} from '../domain/matching.types';

const DRIVER_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const DRIVER_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ORDER_ID = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';

function assignment(
  overrides: Partial<AssignmentRecord> = {},
): AssignmentRecord {
  return {
    id: overrides.id ?? 'asg-1',
    deliveryId: DELIVERY_ID,
    driverId: DRIVER_A,
    status: ASSIGNMENT_STATUS_OFFERED,
    assignedAt: '2026-09-02T00:00:00.000Z',
    acceptedAt: null,
    releasedAt: null,
    ...overrides,
  };
}

describe('MatchingService', () => {
  const context = {
    deliveryId: DELIVERY_ID,
    orderId: ORDER_ID,
    customerId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    publicReference: 'sgo_match',
    deliveryStatus: DELIVERY_STATUS_SEARCHING_DRIVER,
    orderStatus: 'ACTIVE',
    fulfillmentStatus: 'READY',
    pickup: {
      merchantBranchId: 'br-1',
      name: 'Cafe',
      addressText: 'Street A',
      latitude: 36.75,
      longitude: 3.05,
    },
    dropoff: {
      addressText: 'Home',
      latitude: 36.76,
      longitude: 3.06,
    },
    driverRemunerationMinor: 300,
  };

  let assignments: AssignmentRecord[];
  let eligible: Set<string>;
  let locations: Map<string, DriverLocationRecord>;
  let geo: GeoCandidate[];
  let service: MatchingService;
  let nowMs: number;
  let jobs: {
    enqueueStart: jest.Mock;
    enqueueTimeout: jest.Mock;
    enqueueRetry: jest.Mock;
    scheduleAfterMatch: jest.Mock;
  };

  beforeEach(() => {
    assignments = [];
    eligible = new Set([DRIVER_A, DRIVER_B]);
    locations = new Map();
    geo = [];
    nowMs = Date.parse('2026-09-02T00:00:10.000Z');
    const store: DriverLocationStore = {
      upsert(driverId, latitude, longitude, recordedAt) {
        const row = {
          driverId,
          latitude,
          longitude,
          recordedAt: recordedAt ?? '2026-09-02T00:00:00.000Z',
        };
        locations.set(driverId, row);
        return Promise.resolve(row);
      },
      get(driverId) {
        return Promise.resolve(locations.get(driverId) ?? null);
      },
      searchNear() {
        return Promise.resolve(geo);
      },
    };
    const config = {
      get: (key: string, fallback: number | string) => {
        if (key === 'matching.offerTimeoutMs') {
          return 30_000;
        }
        if (key === 'matching.locationMaxAgeMs') {
          return 45_000;
        }
        if (key === 'matching.pickupRadiusMeters') {
          return 5000;
        }
        if (key === 'matching.candidateLimit') {
          return 20;
        }
        return fallback;
      },
    };
    jobs = {
      enqueueStart: jest.fn().mockResolvedValue(undefined),
      enqueueTimeout: jest.fn().mockResolvedValue(undefined),
      enqueueRetry: jest.fn().mockResolvedValue(undefined),
      scheduleAfterMatch: jest.fn().mockResolvedValue(undefined),
    };
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-02T00:00:00.000Z',
    });
    locations.set(DRIVER_B, {
      driverId: DRIVER_B,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-02T00:00:00.000Z',
    });
    service = new MatchingService(
      {
        createForReadyOrder: () =>
          Promise.resolve({
            id: DELIVERY_ID,
            orderId: ORDER_ID,
          }),
      } as never,
      {
        lockDelivery: () =>
          Promise.resolve({
            id: DELIVERY_ID,
            orderId: ORDER_ID,
            status: DELIVERY_STATUS_SEARCHING_DRIVER,
          }),
        findMatchingContext: () => Promise.resolve(context),
      } as never,
      {
        matchingEligibility: (driverId: string) =>
          Promise.resolve(eligible.has(driverId)),
      } as never,
      {
        findProfileByAccountId: (accountId: string) =>
          Promise.resolve(
            accountId === ACCOUNT_A
              ? { id: DRIVER_A, accountId: ACCOUNT_A }
              : null,
          ),
        lockProfile: (driverId: string) => Promise.resolve({ id: driverId }),
        findAvailability: () => Promise.resolve({ status: 'ONLINE' }),
      } as never,
      {
        runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
        findById: (id: string) =>
          Promise.resolve(assignments.find((row) => row.id === id) ?? null),
        findOpenByDelivery: (deliveryId: string) =>
          Promise.resolve(
            assignments.find(
              (row) => row.deliveryId === deliveryId && row.releasedAt === null,
            ) ?? null,
          ),
        findOpenByDriver: (driverId: string) =>
          Promise.resolve(
            assignments.find(
              (row) => row.driverId === driverId && row.releasedAt === null,
            ) ?? null,
          ),
        listDriverIdsForDelivery: () =>
          Promise.resolve(assignments.map((row) => row.driverId)),
        createOffer: (_deliveryId: string, driverId: string) => {
          const created = assignment({
            id: `asg-${assignments.length + 1}`,
            driverId,
          });
          assignments.push(created);
          return Promise.resolve(created);
        },
        releaseIfOffered: (id: string, status: string) => {
          const row = assignments.find((item) => item.id === id);
          if (!row || row.status !== ASSIGNMENT_STATUS_OFFERED) {
            return Promise.resolve(null);
          }
          row.status = status;
          row.releasedAt = '2026-09-02T00:00:20.000Z';
          return Promise.resolve(row);
        },
        acceptIfOffered: (id: string) => {
          const row = assignments.find((item) => item.id === id);
          if (!row || row.status !== ASSIGNMENT_STATUS_OFFERED) {
            return Promise.resolve(null);
          }
          row.status = ASSIGNMENT_STATUS_ACCEPTED;
          row.acceptedAt = '2026-09-02T00:00:15.000Z';
          return Promise.resolve(row);
        },
        setDeliveryAssigned: () => Promise.resolve(true),
      } as never,
      {
        notifyMatchOffer: jest.fn().mockResolvedValue(undefined),
        notifyDriverAssigned: jest.fn().mockResolvedValue(undefined),
      } as never,
      store,
      config as unknown as ConfigService,
      jobs,
    );
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates one offer for the nearest eligible Driver', async () => {
    geo = [
      {
        driverId: DRIVER_B,
        distanceMeters: 200,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        driverId: DRIVER_A,
        distanceMeters: 80,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.offered).toBe(true);
    expect(result.assignment?.driverId).toBe(DRIVER_A);
    expect(assignments).toHaveLength(1);
  });

  it('excludes offline, suspended, expired-license, and busy Drivers', async () => {
    eligible.delete(DRIVER_A);
    geo = [
      {
        driverId: DRIVER_A,
        distanceMeters: 10,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        driverId: DRIVER_B,
        distanceMeters: 20,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.assignment?.driverId).toBe(DRIVER_B);
  });

  it('does not create a second open offer for the same Delivery', async () => {
    assignments.push(assignment());
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.assignment?.id).toBe('asg-1');
    expect(assignments).toHaveLength(1);
  });

  it('accepts an own offer and rejects a foreign accept', async () => {
    assignments.push(assignment());
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-02T00:00:00.000Z',
    });
    const accepted = await service.accept(ACCOUNT_A, 'asg-1');
    expect(accepted.status).toBe(ASSIGNMENT_STATUS_ACCEPTED);
    await expect(
      service.accept('22222222-2222-7222-8222-222222222222', 'asg-1'),
    ).rejects.toMatchObject({
      code: MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_NOT_FOUND,
    });
  });

  it('rejects an offer and continues matching the next Driver', async () => {
    assignments.push(assignment());
    geo = [
      {
        driverId: DRIVER_B,
        distanceMeters: 40,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const continued = await service.reject(ACCOUNT_A, 'asg-1');
    expect(assignments[0].status).toBe(ASSIGNMENT_STATUS_REJECTED);
    expect(continued.assignment?.driverId).toBe(DRIVER_B);
    expect(continued.deliveryStatus).toBe(DELIVERY_STATUS_SEARCHING_DRIVER);
  });

  it('expires an overdue offer exactly once and ignores timeout after accept', async () => {
    assignments.push(assignment({ assignedAt: '2026-09-02T00:00:00.000Z' }));
    nowMs = Date.parse('2026-09-02T00:00:30.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const expired = await service.expireOffer('asg-1');
    expect(expired?.status).toBe(ASSIGNMENT_STATUS_EXPIRED);
    const again = await service.expireOffer('asg-1');
    expect(again?.status).toBe(ASSIGNMENT_STATUS_EXPIRED);
    assignments[0].status = ASSIGNMENT_STATUS_ACCEPTED;
    assignments[0].releasedAt = null;
    assignments[0].acceptedAt = '2026-09-02T00:00:15.000Z';
    const afterAccept = await service.expireOffer('asg-1');
    expect(afterAccept?.status).toBe(ASSIGNMENT_STATUS_ACCEPTED);
  });

  it('blocks accept when location is missing or stale', async () => {
    assignments.push(assignment());
    locations.delete(DRIVER_A);
    await expect(service.accept(ACCOUNT_A, 'asg-1')).rejects.toMatchObject({
      code: MATCHING_ERROR_CODES.DRIVER_LOCATION_REQUIRED,
    });
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-01T23:59:14.000Z',
    });
    await expect(service.accept(ACCOUNT_A, 'asg-1')).rejects.toMatchObject({
      code: MATCHING_ERROR_CODES.DRIVER_LOCATION_STALE,
    });
  });

  it('keeps SEARCHING_DRIVER when no eligible Driver exists', async () => {
    geo = [];
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.offered).toBe(false);
    expect(result.assignment).toBeNull();
    expect(result.deliveryStatus).toBe(DELIVERY_STATUS_SEARCHING_DRIVER);
    expect(assignments).toHaveLength(0);
    expect(jobs.scheduleAfterMatch).toHaveBeenCalledWith(
      expect.objectContaining({ offered: false, assignment: null }),
    );
  });

  it('skips a Driver who already has an open assignment', async () => {
    assignments.push(
      assignment({
        id: 'asg-other',
        deliveryId: 'other-delivery',
        driverId: DRIVER_A,
      }),
    );
    geo = [
      {
        driverId: DRIVER_A,
        distanceMeters: 10,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        driverId: DRIVER_B,
        distanceMeters: 20,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.assignment?.driverId).toBe(DRIVER_B);
  });

  it('blocks accept of an expired or rejected offer', async () => {
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-02T00:00:00.000Z',
    });
    assignments.push(
      assignment({
        assignedAt: '2026-09-02T00:00:00.000Z',
      }),
    );
    nowMs = Date.parse('2026-09-02T00:00:30.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    await expect(service.accept(ACCOUNT_A, 'asg-1')).rejects.toMatchObject({
      code: MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_EXPIRED,
    });
    assignments[0].status = ASSIGNMENT_STATUS_REJECTED;
    assignments[0].releasedAt = '2026-09-02T00:00:20.000Z';
    assignments[0].assignedAt = '2026-09-02T00:00:00.000Z';
    nowMs = Date.parse('2026-09-02T00:00:10.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    await expect(service.accept(ACCOUNT_A, 'asg-1')).rejects.toMatchObject({
      code: MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_INVALID_STATE,
    });
  });

  it('omits Customer and Merchant contact from the offer DTO', async () => {
    assignments.push(assignment());
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-02T00:00:00.000Z',
    });
    const offer = await service.getCurrentOffer(ACCOUNT_A);
    expect(offer?.pickup).toEqual({ name: 'Cafe' });
    expect(JSON.stringify(offer)).not.toContain('Home');
    expect(JSON.stringify(offer)).not.toContain('phone');
  });

  it('does not re-offer a Driver who already rejected the same Delivery', async () => {
    assignments.push(
      assignment({
        status: ASSIGNMENT_STATUS_REJECTED,
        releasedAt: '2026-09-02T00:00:05.000Z',
      }),
    );
    geo = [
      {
        driverId: DRIVER_A,
        distanceMeters: 10,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        driverId: DRIVER_B,
        distanceMeters: 20,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const result = await service.matchDelivery(DELIVERY_ID);
    expect(result.assignment?.driverId).toBe(DRIVER_B);
  });

  it('allows accept when location is exactly 45 seconds old', async () => {
    assignments.push(assignment());
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-01T23:59:25.000Z',
    });
    const accepted = await service.accept(ACCOUNT_A, 'asg-1');
    expect(accepted.status).toBe(ASSIGNMENT_STATUS_ACCEPTED);
  });

  it('skips a GEO candidate whose live location is stale or beyond 5 km', async () => {
    locations.set(DRIVER_A, {
      driverId: DRIVER_A,
      latitude: 36.75,
      longitude: 3.05,
      recordedAt: '2026-09-01T23:59:14.000Z',
    });
    geo = [
      {
        driverId: DRIVER_A,
        distanceMeters: 10,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        driverId: DRIVER_B,
        distanceMeters: 5001,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const none = await service.matchDelivery(DELIVERY_ID);
    expect(none.offered).toBe(false);
    geo[1] = {
      driverId: DRIVER_B,
      distanceMeters: 5000,
      recordedAt: '2026-09-02T00:00:00.000Z',
    };
    const boundary = await service.matchDelivery(DELIVERY_ID);
    expect(boundary.assignment?.driverId).toBe(DRIVER_B);
  });

  it('expires an open offer from the timeout worker even before lazy clock expiry', async () => {
    assignments.push(assignment({ assignedAt: '2026-09-02T00:00:00.000Z' }));
    geo = [
      {
        driverId: DRIVER_B,
        distanceMeters: 40,
        recordedAt: '2026-09-02T00:00:00.000Z',
      },
    ];
    const continued = await service.expireAndContinue('asg-1');
    expect(assignments[0].status).toBe(ASSIGNMENT_STATUS_EXPIRED);
    expect(continued?.assignment?.driverId).toBe(DRIVER_B);
    expect(await service.expireAndContinue('asg-1')).toBeNull();
  });

  it('does not let the timeout worker overwrite ACCEPTED', async () => {
    assignments.push(
      assignment({
        status: ASSIGNMENT_STATUS_ACCEPTED,
        acceptedAt: '2026-09-02T00:00:15.000Z',
      }),
    );
    expect(await service.expireAndContinue('asg-1')).toBeNull();
    expect(assignments[0].status).toBe(ASSIGNMENT_STATUS_ACCEPTED);
  });
});
