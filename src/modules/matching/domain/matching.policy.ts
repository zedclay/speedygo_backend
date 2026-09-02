export const ASSIGNMENT_STATUS_OFFERED = 'OFFERED';
export const ASSIGNMENT_STATUS_ACCEPTED = 'ACCEPTED';
export const ASSIGNMENT_STATUS_REJECTED = 'REJECTED';
export const ASSIGNMENT_STATUS_EXPIRED = 'EXPIRED';

export const ASSIGNMENT_STATUSES = [
  ASSIGNMENT_STATUS_OFFERED,
  ASSIGNMENT_STATUS_ACCEPTED,
  ASSIGNMENT_STATUS_REJECTED,
  ASSIGNMENT_STATUS_EXPIRED,
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const DELIVERY_EVENT_DRIVER_ASSIGNED = 'DRIVER_ASSIGNED';

export function isOpenOffer(
  status: string,
  releasedAt: string | null,
): boolean {
  return status === ASSIGNMENT_STATUS_OFFERED && releasedAt === null;
}

export function isAcceptedAssignment(
  status: string,
  releasedAt: string | null,
): boolean {
  return status === ASSIGNMENT_STATUS_ACCEPTED && releasedAt === null;
}

export function isFiniteCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

export function isValidLatitude(value: number): boolean {
  return isFiniteCoordinate(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return isFiniteCoordinate(value) && value >= -180 && value <= 180;
}

export function isValidLocation(latitude: number, longitude: number): boolean {
  return isValidLatitude(latitude) && isValidLongitude(longitude);
}

export function isLocationFresh(
  recordedAt: string,
  maxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  const recordedMs = Date.parse(recordedAt);
  if (!Number.isFinite(recordedMs) || maxAgeMs <= 0) {
    return false;
  }
  return nowMs - recordedMs <= maxAgeMs;
}

export function offerExpiresAt(
  assignedAt: string,
  offerTimeoutMs: number,
): string {
  const start = Date.parse(assignedAt);
  return new Date(start + offerTimeoutMs).toISOString();
}

export function isOfferExpired(
  assignedAt: string,
  offerTimeoutMs: number,
  nowMs = Date.now(),
): boolean {
  const start = Date.parse(assignedAt);
  if (!Number.isFinite(start) || offerTimeoutMs <= 0) {
    return true;
  }
  return nowMs >= start + offerTimeoutMs;
}

export function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthMeters = 6_371_000;
  const dLat = toRad(latitudeB - latitudeA);
  const dLon = toRad(longitudeB - longitudeA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latitudeA)) *
      Math.cos(toRad(latitudeB)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * earthMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function rankCandidates<
  T extends { driverId: string; distanceMeters: number },
>(candidates: T[]): T[] {
  return [...candidates].sort((left, right) => {
    if (left.distanceMeters !== right.distanceMeters) {
      return left.distanceMeters - right.distanceMeters;
    }
    return left.driverId.localeCompare(right.driverId);
  });
}

export function isWithinPickupRadius(
  distanceMeters: number,
  radiusMeters: number,
): boolean {
  return (
    Number.isFinite(distanceMeters) &&
    Number.isFinite(radiusMeters) &&
    radiusMeters > 0 &&
    distanceMeters <= radiusMeters
  );
}

export function remainingOfferDelayMs(
  assignedAt: string,
  offerTimeoutMs: number,
  nowMs = Date.now(),
): number {
  const start = Date.parse(assignedAt);
  if (!Number.isFinite(start) || offerTimeoutMs <= 0) {
    return 0;
  }
  return Math.max(0, start + offerTimeoutMs - nowMs);
}

export function roundDistanceMeters(distanceMeters: number): number {
  return Math.round(distanceMeters);
}
