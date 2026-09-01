export const DRIVER_VERIFICATION_UNVERIFIED = 'UNVERIFIED';
export const DRIVER_VERIFICATION_PENDING_REVIEW = 'PENDING_REVIEW';
export const DRIVER_VERIFICATION_APPROVED = 'APPROVED';
export const DRIVER_VERIFICATION_REJECTED = 'REJECTED';
export const DRIVER_VERIFICATION_SUSPENDED = 'SUSPENDED';

export const DRIVER_VERIFICATION_STATUSES = [
  DRIVER_VERIFICATION_UNVERIFIED,
  DRIVER_VERIFICATION_PENDING_REVIEW,
  DRIVER_VERIFICATION_APPROVED,
  DRIVER_VERIFICATION_REJECTED,
  DRIVER_VERIFICATION_SUSPENDED,
] as const;

export type DriverVerificationStatus =
  (typeof DRIVER_VERIFICATION_STATUSES)[number];

export const DRIVER_INITIAL_VERIFICATION_STATUS =
  DRIVER_VERIFICATION_UNVERIFIED;

export const DRIVER_AVAILABILITY_OFFLINE = 'OFFLINE';
export const DRIVER_AVAILABILITY_ONLINE = 'ONLINE';
export const DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY =
  'OFFLINE_AFTER_CURRENT_DELIVERY';
export const DRIVER_AVAILABILITY_SUSPENDED = 'SUSPENDED';

export const DRIVER_AVAILABILITY_STATUSES = [
  DRIVER_AVAILABILITY_OFFLINE,
  DRIVER_AVAILABILITY_ONLINE,
  DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY,
  DRIVER_AVAILABILITY_SUSPENDED,
] as const;

export type DriverAvailabilityStatus =
  (typeof DRIVER_AVAILABILITY_STATUSES)[number];

export const DRIVER_INITIAL_AVAILABILITY_STATUS = DRIVER_AVAILABILITY_OFFLINE;

export const DRIVER_DOCUMENT_IDENTITY = 'IDENTITY';
export const DRIVER_DOCUMENT_DRIVING_LICENSE = 'DRIVING_LICENSE';

export const DRIVER_DOCUMENT_TYPES = [
  DRIVER_DOCUMENT_IDENTITY,
  DRIVER_DOCUMENT_DRIVING_LICENSE,
] as const;

export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_DOCUMENT_STATUS_PENDING = 'PENDING';

export const DRIVER_VEHICLE_STATUS_ACTIVE = 'ACTIVE';
export const DRIVER_VEHICLE_STATUS_INACTIVE = 'INACTIVE';

export const DRIVER_VEHICLE_TYPES = ['MOTORCYCLE', 'CAR', 'SCOOTER'] as const;

export type DriverVehicleType = (typeof DRIVER_VEHICLE_TYPES)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDriverDocumentType(
  value: string,
): value is DriverDocumentType {
  return (DRIVER_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isDriverVehicleType(value: string): value is DriverVehicleType {
  return (DRIVER_VEHICLE_TYPES as readonly string[]).includes(value);
}

export function isEditableOnboardingStatus(status: string): boolean {
  return (
    status === DRIVER_VERIFICATION_UNVERIFIED ||
    status === DRIVER_VERIFICATION_REJECTED
  );
}

export function canSubmitVerification(status: string): boolean {
  return (
    status === DRIVER_VERIFICATION_UNVERIFIED ||
    status === DRIVER_VERIFICATION_REJECTED
  );
}

export function isApprovedVerification(status: string): boolean {
  return status === DRIVER_VERIFICATION_APPROVED;
}

export function isSuspendedVerification(status: string): boolean {
  return status === DRIVER_VERIFICATION_SUSPENDED;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    value === parsed.toISOString().slice(0, 10)
  );
}

export function utcTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isExpiryValid(
  expiryDate: string | null,
  today = utcTodayIsoDate(),
): boolean {
  if (!expiryDate) {
    return false;
  }
  return isIsoDate(expiryDate) && expiryDate >= today;
}

export function isOptionalExpiryValid(
  expiryDate: string | null,
  today = utcTodayIsoDate(),
): boolean {
  if (!expiryDate) {
    return true;
  }
  return isExpiryValid(expiryDate, today);
}

export function normalizePlate(plateNumber: string): string {
  return plateNumber.replace(/\s+/g, '').toUpperCase();
}

export function isProfileComplete(fullName: string): boolean {
  return fullName.trim().length > 0;
}

export function isIdentityDocumentComplete(
  input: {
    type: string;
    expiryDate: string | null;
  } | null,
): boolean {
  return Boolean(
    input &&
    input.type === DRIVER_DOCUMENT_IDENTITY &&
    isOptionalExpiryValid(input.expiryDate),
  );
}

export function isDrivingLicenseComplete(
  input: {
    type: string;
    expiryDate: string | null;
  } | null,
): boolean {
  return Boolean(
    input &&
    input.type === DRIVER_DOCUMENT_DRIVING_LICENSE &&
    isExpiryValid(input.expiryDate),
  );
}

export function hasActiveVehicle(vehicles: Array<{ status: string }>): boolean {
  return vehicles.some(
    (vehicle) => vehicle.status === DRIVER_VEHICLE_STATUS_ACTIVE,
  );
}

export function isOnboardingReady(input: {
  fullName: string;
  identity: { type: string; expiryDate: string | null } | null;
  license: { type: string; expiryDate: string | null } | null;
  vehicles: Array<{ status: string }>;
}): boolean {
  return (
    isProfileComplete(input.fullName) &&
    isIdentityDocumentComplete(input.identity) &&
    isDrivingLicenseComplete(input.license) &&
    hasActiveVehicle(input.vehicles)
  );
}

export function isOperationalReady(input: {
  verificationStatus: string;
  fullName: string;
  identity: { type: string; expiryDate: string | null } | null;
  license: { type: string; expiryDate: string | null } | null;
  vehicles: Array<{ status: string }>;
}): boolean {
  return (
    isApprovedVerification(input.verificationStatus) && isOnboardingReady(input)
  );
}

export function canGoOnline(input: {
  verificationStatus: string;
  availabilityStatus: string;
  operationalReady: boolean;
}): boolean {
  return (
    input.operationalReady &&
    input.availabilityStatus === DRIVER_AVAILABILITY_OFFLINE &&
    !isSuspendedVerification(input.verificationStatus)
  );
}

export function canParticipateInMatching(input: {
  verificationStatus: string;
  availabilityStatus: string;
  operationalReady: boolean;
}): boolean {
  return (
    input.operationalReady &&
    input.availabilityStatus === DRIVER_AVAILABILITY_ONLINE &&
    isApprovedVerification(input.verificationStatus)
  );
}

export function objectKeyForDocument(documentId: string): string {
  return `sg-object:driver-document:${documentId}`;
}
