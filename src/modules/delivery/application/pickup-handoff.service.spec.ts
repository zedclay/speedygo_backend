import { PickupHandoffService } from './pickup-handoff.service';
import { PICKUP_HANDOFF_ERROR_CODES } from '../domain/pickup-handoff.errors';
import {
  hashPickupHandoffCode,
  sealPickupHandoffCode,
  PICKUP_HANDOFF_STATUS_CONSUMED,
  PICKUP_HANDOFF_STATUS_LOCKED,
  PICKUP_HANDOFF_STATUS_PENDING,
} from '../domain/pickup-handoff.types';

const SECRET = 'test-pickup-handoff-secret-32-chars!!';
const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const MERCHANT = '33333333-3333-7333-8333-333333333333';
const ORDER_ID = '55555555-5555-7555-8555-555555555555';
const BRANCH = '66666666-6666-7666-8666-666666666666';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ASSIGNMENT_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const DRIVER_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function handoff(overrides: Record<string, unknown> = {}) {
  const code = '1234';
  return {
    id: 'handoff-1',
    deliveryId: DELIVERY_ID,
    assignmentId: ASSIGNMENT_ID,
    assignmentVersion: 1,
    codeHash: hashPickupHandoffCode(SECRET, code),
    codeSealed: sealPickupHandoffCode(SECRET, code),
    status: PICKUP_HANDOFF_STATUS_PENDING,
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    lockedUntil: null,
    consumedAt: null,
    consumedByDriverId: null,
    createdByAccountId: ACCOUNT,
    invalidatedAt: null,
    invalidatedReason: null,
    version: 1,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('PickupHandoffService', () => {
  let access: { requireCapability: jest.Mock };
  let deliveries: Record<string, jest.Mock>;
  let pickupHandoffs: Record<string, jest.Mock>;
  let config: { get: jest.Mock };
  let service: PickupHandoffService;

  beforeEach(() => {
    access = { requireCapability: jest.fn().mockResolvedValue({}) };
    deliveries = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockDelivery: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        orderId: ORDER_ID,
        status: 'AT_PICKUP',
      }),
      findOrderRecord: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        merchantBranchId: BRANCH,
        status: 'ACTIVE',
      }),
      findBranchMerchantId: jest.fn().mockResolvedValue(MERCHANT),
      findDeliveryIdByOrderId: jest.fn().mockResolvedValue(DELIVERY_ID),
      findDeliveryById: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        orderId: ORDER_ID,
        status: 'AT_PICKUP',
      }),
      findOpenAcceptedAssignmentForDelivery: jest.fn().mockResolvedValue({
        id: ASSIGNMENT_ID,
        driverId: DRIVER_ID,
        version: 1,
        status: 'ACCEPTED',
        releasedAt: null,
      }),
      transitionIfStatus: jest.fn().mockResolvedValue(true),
    };
    pickupHandoffs = {
      findPending: jest.fn().mockResolvedValue(null),
      findVerifiable: jest.fn().mockResolvedValue(null),
      findConsumedForAssignment: jest.fn().mockResolvedValue(null),
      invalidatePending: jest.fn().mockResolvedValue(1),
      insert: jest.fn().mockImplementation((_input, _tx) =>
        Promise.resolve(handoff()),
      ),
      markExpired: jest.fn().mockResolvedValue(true),
      unlockIfDue: jest.fn(),
      incrementAttemptsAndMaybeLock: jest.fn().mockResolvedValue(
        handoff({ attemptCount: 1 }),
      ),
      consumeConditional: jest.fn().mockResolvedValue(true),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'auth.otpHmacSecret' ? SECRET : '',
      ),
    };
    service = new PickupHandoffService(
      deliveries as never,
      pickupHandoffs as never,
      access as never,
      config as never,
    );
  });

  it('issues a merchant handoff with plaintext code and no secrets in metadata fields', async () => {
    const view = await service.getOrIssueForMerchant(
      ACCOUNT,
      MERCHANT,
      ORDER_ID,
    );
    expect(view.pickupCode).toMatch(/^\d{4}$/);
    expect(view.status).toBe(PICKUP_HANDOFF_STATUS_PENDING);
    expect(view.assignmentId).toBe(ASSIGNMENT_ID);
    expect(view.attemptsRemaining).toBe(5);
    expect(JSON.stringify(view)).not.toContain('codeHash');
    expect(JSON.stringify(view)).not.toContain('codeSealed');
  });

  it('reuses an existing pending handoff for the same assignment', async () => {
    pickupHandoffs.findPending.mockResolvedValue(handoff());
    const view = await service.getOrIssueForMerchant(
      ACCOUNT,
      MERCHANT,
      ORDER_ID,
    );
    expect(view.pickupCode).toBe('1234');
    expect(pickupHandoffs.insert).not.toHaveBeenCalled();
  });

  it('regenerates by invalidating pending and inserting a new handoff', async () => {
    pickupHandoffs.findPending.mockResolvedValue(handoff());
    await service.regenerateForMerchant(ACCOUNT, MERCHANT, ORDER_ID);
    expect(pickupHandoffs.invalidatePending).toHaveBeenCalledWith(
      DELIVERY_ID,
      'REGENERATED',
      {},
    );
    expect(pickupHandoffs.insert).toHaveBeenCalled();
  });

  it('verifies a correct code and transitions delivery atomically', async () => {
    pickupHandoffs.findVerifiable.mockResolvedValue(handoff());
    const outcome = await service.verifyForConfirmPickup({
      deliveryId: DELIVERY_ID,
      driverId: DRIVER_ID,
      assignmentId: ASSIGNMENT_ID,
      assignmentVersion: 1,
      body: {
        pickupCode: '1234',
        assignmentId: ASSIGNMENT_ID,
        assignmentVersion: 1,
      },
    });
    expect(outcome).toBe('verified');
    expect(pickupHandoffs.consumeConditional).toHaveBeenCalled();
    expect(deliveries.transitionIfStatus).toHaveBeenCalled();
  });

  it('rejects a wrong code and increments attempts', async () => {
    pickupHandoffs.findVerifiable.mockResolvedValue(handoff());
    await expect(
      service.verifyForConfirmPickup({
        deliveryId: DELIVERY_ID,
        driverId: DRIVER_ID,
        assignmentId: ASSIGNMENT_ID,
        assignmentVersion: 1,
        body: {
          pickupCode: '9999',
          assignmentId: ASSIGNMENT_ID,
          assignmentVersion: 1,
        },
      }),
    ).rejects.toMatchObject({
      code: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_CODE_INVALID,
    });
    expect(pickupHandoffs.incrementAttemptsAndMaybeLock).toHaveBeenCalled();
  });

  it('rejects expired handoffs', async () => {
    pickupHandoffs.findVerifiable.mockResolvedValue(
      handoff({ expiresAt: '2020-01-01T00:00:00.000Z' }),
    );
    await expect(
      service.verifyForConfirmPickup({
        deliveryId: DELIVERY_ID,
        driverId: DRIVER_ID,
        assignmentId: ASSIGNMENT_ID,
        assignmentVersion: 1,
        body: {
          pickupCode: '1234',
          assignmentId: ASSIGNMENT_ID,
          assignmentVersion: 1,
        },
      }),
    ).rejects.toMatchObject({
      code: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_EXPIRED,
    });
  });

  it('rejects locked handoffs', async () => {
    pickupHandoffs.findVerifiable.mockResolvedValue(
      handoff({
        status: PICKUP_HANDOFF_STATUS_LOCKED,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    await expect(
      service.verifyForConfirmPickup({
        deliveryId: DELIVERY_ID,
        driverId: DRIVER_ID,
        assignmentId: ASSIGNMENT_ID,
        assignmentVersion: 1,
        body: {
          pickupCode: '1234',
          assignmentId: ASSIGNMENT_ID,
          assignmentVersion: 1,
        },
      }),
    ).rejects.toMatchObject({
      code: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_LOCKED,
    });
  });

  it('rejects assignment conflicts', async () => {
    pickupHandoffs.findVerifiable.mockResolvedValue(
      handoff({ assignmentVersion: 2 }),
    );
    await expect(
      service.verifyForConfirmPickup({
        deliveryId: DELIVERY_ID,
        driverId: DRIVER_ID,
        assignmentId: ASSIGNMENT_ID,
        assignmentVersion: 1,
        body: {
          pickupCode: '1234',
          assignmentId: ASSIGNMENT_ID,
          assignmentVersion: 1,
        },
      }),
    ).rejects.toMatchObject({
      code: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_ASSIGNMENT_CONFLICT,
    });
  });

  it('returns legacy when no pending handoff exists', async () => {
    const outcome = await service.verifyForConfirmPickup({
      deliveryId: DELIVERY_ID,
      driverId: DRIVER_ID,
      assignmentId: ASSIGNMENT_ID,
      assignmentVersion: 1,
    });
    expect(outcome).toBe('legacy');
  });

  it('detects already confirmed pickup for idempotent retries', async () => {
    deliveries.findDeliveryById.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'PICKED_UP',
    });
    pickupHandoffs.findConsumedForAssignment.mockResolvedValue(
      handoff({
        status: PICKUP_HANDOFF_STATUS_CONSUMED,
        consumedByDriverId: DRIVER_ID,
      }),
    );
    await expect(
      service.isAlreadyConfirmed(DELIVERY_ID, ASSIGNMENT_ID, DRIVER_ID),
    ).resolves.toBe(true);
  });
});
