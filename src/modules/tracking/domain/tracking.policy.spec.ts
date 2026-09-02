import { isValidLocation } from '../../matching/domain/matching.policy';
import { TRACKING_ERROR_CODES } from './tracking.errors';
import {
  canPublishDriverLocation,
  isNewerRecordedAt,
  isTrackableDeliveryStatus,
  parseLocationUpdate,
  trackingStatusFor,
} from './tracking.policy';

function expectInvalid(input: {
  latitude: unknown;
  longitude: unknown;
  accuracyMeters?: unknown;
}): void {
  try {
    parseLocationUpdate(input);
    throw new Error('expected invalid location');
  } catch (error) {
    expect((error as { code: string }).code).toBe(
      TRACKING_ERROR_CODES.DRIVER_LOCATION_INVALID,
    );
  }
}

describe('Tracking policy', () => {
  it('accepts coordinate boundaries and rejects impossible values', () => {
    expect(isValidLocation(-90, -180)).toBe(true);
    expect(isValidLocation(90, 180)).toBe(true);
    expectInvalid({ latitude: 91, longitude: 0 });
    expectInvalid({ latitude: Number.NaN, longitude: 0 });
    expectInvalid({ latitude: Number.POSITIVE_INFINITY, longitude: 0 });
    expectInvalid({ latitude: 'x', longitude: 3 });
    expect(
      parseLocationUpdate({
        latitude: 36.75,
        longitude: 3.05,
        accuracyMeters: 12,
      }),
    ).toEqual({ latitude: 36.75, longitude: 3.05, accuracyMeters: 12 });
    expectInvalid({
      latitude: 36.75,
      longitude: 3.05,
      accuracyMeters: -1,
    });
  });

  it('allows ONLINE and assigned OFFLINE_AFTER Drivers to publish', () => {
    expect(
      canPublishDriverLocation({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'ONLINE',
        hasAcceptedAssignment: false,
      }),
    ).toBe(true);
    expect(
      canPublishDriverLocation({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'OFFLINE_AFTER_CURRENT_DELIVERY',
        hasAcceptedAssignment: true,
      }),
    ).toBe(true);
    expect(
      canPublishDriverLocation({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'OFFLINE',
        hasAcceptedAssignment: false,
      }),
    ).toBe(false);
    expect(
      canPublishDriverLocation({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'OFFLINE',
        hasAcceptedAssignment: true,
      }),
    ).toBe(true);
    expect(
      canPublishDriverLocation({
        verificationStatus: 'SUSPENDED',
        availabilityStatus: 'SUSPENDED',
        hasAcceptedAssignment: true,
      }),
    ).toBe(false);
    expect(
      canPublishDriverLocation({
        verificationStatus: 'APPROVED',
        availabilityStatus: null,
        hasAcceptedAssignment: false,
      }),
    ).toBe(false);
  });

  it('classifies tracking status and trackable Delivery statuses', () => {
    const now = Date.parse('2026-09-02T00:00:45.000Z');
    expect(
      trackingStatusFor({
        assignedDriverId: null,
        recordedAt: null,
        maxAgeMs: 45_000,
        nowMs: now,
      }),
    ).toBe('NO_DRIVER');
    expect(
      trackingStatusFor({
        assignedDriverId: 'drv',
        recordedAt: null,
        maxAgeMs: 45_000,
        nowMs: now,
      }),
    ).toBe('UNAVAILABLE');
    expect(
      trackingStatusFor({
        assignedDriverId: 'drv',
        recordedAt: '2026-09-02T00:00:00.000Z',
        maxAgeMs: 45_000,
        nowMs: now,
      }),
    ).toBe('LIVE');
    expect(
      trackingStatusFor({
        assignedDriverId: 'drv',
        recordedAt: '2026-09-01T23:59:59.000Z',
        maxAgeMs: 45_000,
        nowMs: now,
      }),
    ).toBe('STALE');
    expect(isTrackableDeliveryStatus('DRIVER_ASSIGNED')).toBe(true);
    expect(isTrackableDeliveryStatus('TO_PICKUP')).toBe(true);
    expect(isTrackableDeliveryStatus('SEARCHING_DRIVER')).toBe(false);
    expect(isTrackableDeliveryStatus('DELIVERED')).toBe(false);
    expect(
      isNewerRecordedAt('2026-09-02T00:00:02.000Z', '2026-09-02T00:00:01.000Z'),
    ).toBe(true);
    expect(
      isNewerRecordedAt('2026-09-02T00:00:01.000Z', '2026-09-02T00:00:02.000Z'),
    ).toBe(false);
  });
});
