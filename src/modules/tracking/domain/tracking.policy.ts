import {
  DELIVERY_STATUS_ARRIVED_CUSTOMER,
  DELIVERY_STATUS_AT_PICKUP,
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_IN_TRANSIT,
  DELIVERY_STATUS_PICKED_UP,
  DELIVERY_STATUS_TO_PICKUP,
  isTerminalDeliveryStatus,
} from '../../delivery/domain/delivery.policy';
import {
  DRIVER_AVAILABILITY_ONLINE,
  DRIVER_AVAILABILITY_SUSPENDED,
  DRIVER_VERIFICATION_APPROVED,
  DRIVER_VERIFICATION_SUSPENDED,
} from '../../drivers/domain/driver.policy';
import {
  isLocationFresh,
  isValidLocation,
} from '../../matching/domain/matching.policy';
import { driverLocationInvalid } from './tracking.errors';
import {
  TRACKING_STATUS_LIVE,
  TRACKING_STATUS_NO_DRIVER,
  TRACKING_STATUS_STALE,
  TRACKING_STATUS_UNAVAILABLE,
  type LocationUpdateInput,
  type TrackingStatus,
} from './tracking.types';

const TRACKABLE_DELIVERY_STATUSES = [
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_TO_PICKUP,
  DELIVERY_STATUS_AT_PICKUP,
  DELIVERY_STATUS_PICKED_UP,
  DELIVERY_STATUS_IN_TRANSIT,
  DELIVERY_STATUS_ARRIVED_CUSTOMER,
] as const;

const MAX_ACCURACY_METERS = 10_000;

export function isTrackableDeliveryStatus(status: string): boolean {
  if (isTerminalDeliveryStatus(status)) {
    return false;
  }
  return (TRACKABLE_DELIVERY_STATUSES as readonly string[]).includes(status);
}

export function canPublishDriverLocation(input: {
  verificationStatus: string;
  availabilityStatus: string | null;
  hasAcceptedAssignment: boolean;
}): boolean {
  if (
    input.verificationStatus === DRIVER_VERIFICATION_SUSPENDED ||
    input.availabilityStatus === DRIVER_AVAILABILITY_SUSPENDED
  ) {
    return false;
  }
  if (input.verificationStatus !== DRIVER_VERIFICATION_APPROVED) {
    return false;
  }
  if (input.availabilityStatus === DRIVER_AVAILABILITY_ONLINE) {
    return true;
  }
  return input.hasAcceptedAssignment;
}

export function parseLocationUpdate(input: LocationUpdateInput): {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
} {
  const latitude = asFiniteNumber(input.latitude);
  const longitude = asFiniteNumber(input.longitude);
  if (!isValidLocation(latitude, longitude)) {
    throw driverLocationInvalid();
  }
  let accuracyMeters: number | null = null;
  if (input.accuracyMeters !== undefined && input.accuracyMeters !== null) {
    const accuracy = asFiniteNumber(input.accuracyMeters);
    if (accuracy < 0 || accuracy > MAX_ACCURACY_METERS) {
      throw driverLocationInvalid();
    }
    accuracyMeters = accuracy;
  }
  return { latitude, longitude, accuracyMeters };
}

export function trackingStatusFor(input: {
  assignedDriverId: string | null;
  recordedAt: string | null;
  maxAgeMs: number;
  nowMs?: number;
}): TrackingStatus {
  if (!input.assignedDriverId) {
    return TRACKING_STATUS_NO_DRIVER;
  }
  if (!input.recordedAt) {
    return TRACKING_STATUS_UNAVAILABLE;
  }
  if (isLocationFresh(input.recordedAt, input.maxAgeMs, input.nowMs)) {
    return TRACKING_STATUS_LIVE;
  }
  return TRACKING_STATUS_STALE;
}

export function isNewerRecordedAt(
  incoming: string,
  current: string | null,
): boolean {
  if (!current) {
    return true;
  }
  return incoming > current;
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw driverLocationInvalid();
    }
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw driverLocationInvalid();
    }
    return parsed;
  }
  throw driverLocationInvalid();
}
