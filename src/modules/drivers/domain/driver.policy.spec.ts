import {
  canGoOnline,
  canParticipateInMatching,
  canSubmitVerification,
  DRIVER_DOCUMENT_DRIVING_LICENSE,
  DRIVER_DOCUMENT_IDENTITY,
  DRIVER_INITIAL_VERIFICATION_STATUS,
  DRIVER_VEHICLE_STATUS_ACTIVE,
  hasActiveVehicle,
  isDrivingLicenseComplete,
  isEditableOnboardingStatus,
  isIdentityDocumentComplete,
  isIsoDate,
  isOnboardingReady,
  isOperationalReady,
  isProfileComplete,
  normalizePlate,
} from './driver.policy';

describe('Driver policy', () => {
  const identity = { type: DRIVER_DOCUMENT_IDENTITY, expiryDate: null };
  const license = {
    type: DRIVER_DOCUMENT_DRIVING_LICENSE,
    expiryDate: '2099-01-01',
  };
  const vehicles = [{ status: DRIVER_VEHICLE_STATUS_ACTIVE }];

  it('starts verification UNVERIFIED and treats only UNVERIFIED/REJECTED as editable', () => {
    expect(DRIVER_INITIAL_VERIFICATION_STATUS).toBe('UNVERIFIED');
    expect(isEditableOnboardingStatus('UNVERIFIED')).toBe(true);
    expect(isEditableOnboardingStatus('REJECTED')).toBe(true);
    expect(isEditableOnboardingStatus('PENDING_REVIEW')).toBe(false);
    expect(isEditableOnboardingStatus('APPROVED')).toBe(false);
    expect(isEditableOnboardingStatus('SUSPENDED')).toBe(false);
  });

  it('requires identity, unexpired license, and an ACTIVE vehicle to submit', () => {
    expect(
      isOnboardingReady({
        fullName: 'Driver',
        identity,
        license,
        vehicles,
      }),
    ).toBe(true);
    expect(
      isOnboardingReady({
        fullName: 'Driver',
        identity: null,
        license,
        vehicles,
      }),
    ).toBe(false);
    expect(
      isDrivingLicenseComplete({
        type: DRIVER_DOCUMENT_DRIVING_LICENSE,
        expiryDate: '2000-01-01',
      }),
    ).toBe(false);
    expect(isIdentityDocumentComplete(identity)).toBe(true);
    expect(
      isIdentityDocumentComplete({
        type: DRIVER_DOCUMENT_IDENTITY,
        expiryDate: '2099-01-01',
      }),
    ).toBe(true);
    expect(
      isIdentityDocumentComplete({
        type: DRIVER_DOCUMENT_IDENTITY,
        expiryDate: '2000-01-01',
      }),
    ).toBe(false);
    expect(hasActiveVehicle([{ status: 'INACTIVE' }])).toBe(false);
    expect(canSubmitVerification('UNVERIFIED')).toBe(true);
    expect(canSubmitVerification('PENDING_REVIEW')).toBe(false);
  });

  it('requires APPROVED + ONLINE + operationalReady for matching', () => {
    const ready = {
      fullName: 'Driver',
      identity,
      license,
      vehicles,
      verificationStatus: 'APPROVED',
    };
    expect(isOperationalReady(ready)).toBe(true);
    expect(
      canGoOnline({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'OFFLINE',
        operationalReady: true,
      }),
    ).toBe(true);
    expect(
      canGoOnline({
        verificationStatus: 'PENDING_REVIEW',
        availabilityStatus: 'OFFLINE',
        operationalReady: false,
      }),
    ).toBe(false);
    expect(
      canParticipateInMatching({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'ONLINE',
        operationalReady: true,
      }),
    ).toBe(true);
    expect(
      canParticipateInMatching({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'OFFLINE',
        operationalReady: true,
      }),
    ).toBe(false);
  });

  it('normalizes plates and validates ISO dates', () => {
    expect(normalizePlate(' ab 123 cd ')).toBe('AB123CD');
    expect(isIsoDate('2026-01-15')).toBe(true);
    expect(isIsoDate('15-01-2026')).toBe(false);
    expect(isProfileComplete('  ')).toBe(false);
  });
});
