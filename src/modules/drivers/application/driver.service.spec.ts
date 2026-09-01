import { DriverReviewService } from './driver-review.service';
import { DriverService } from './driver.service';
import {
  driverProfileAlreadyExists,
  driverVehicleConflict,
  DRIVER_ERROR_CODES,
} from '../domain/driver.errors';
import {
  DRIVER_AVAILABILITY_OFFLINE,
  DRIVER_AVAILABILITY_ONLINE,
  DRIVER_DOCUMENT_DRIVING_LICENSE,
  DRIVER_DOCUMENT_IDENTITY,
  DRIVER_DOCUMENT_STATUS_PENDING,
  DRIVER_INITIAL_AVAILABILITY_STATUS,
  DRIVER_INITIAL_VERIFICATION_STATUS,
  DRIVER_VEHICLE_STATUS_ACTIVE,
  DRIVER_VEHICLE_STATUS_INACTIVE,
  DRIVER_VERIFICATION_PENDING_REVIEW,
  DRIVER_VERIFICATION_SUSPENDED,
  objectKeyForDocument,
} from '../domain/driver.policy';
import type {
  CreateDriverProfileInput,
  CreateVehicleInput,
  DriverAvailabilityRecord,
  DriverDocumentRecord,
  DriverProfileRecord,
  DriverVehicleRecord,
  UpdateDriverProfileInput,
  UpdateVehicleInput,
} from '../domain/driver.types';
import type { OrmClient } from '../infrastructure/driver.repository';

const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

function now(): string {
  return '2026-01-15T12:00:00.000Z';
}

class MemoryDriverRepository {
  profiles = new Map<string, DriverProfileRecord>();
  documents = new Map<string, DriverDocumentRecord[]>();
  vehicles = new Map<string, DriverVehicleRecord[]>();
  availability = new Map<string, DriverAvailabilityRecord>();
  uniqueCreateShouldFail = false;
  uniquePlateShouldFail = false;

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return fn({} as OrmClient);
  }

  findProfileByAccountId(
    accountId: string,
  ): Promise<DriverProfileRecord | null> {
    return Promise.resolve(
      [...this.profiles.values()].find((row) => row.accountId === accountId) ??
        null,
    );
  }

  findProfileById(driverId: string): Promise<DriverProfileRecord | null> {
    return Promise.resolve(this.profiles.get(driverId) ?? null);
  }

  lockProfile(driverId: string): Promise<DriverProfileRecord | null> {
    return this.findProfileById(driverId);
  }

  createProfileWithAvailability(
    accountId: string,
    input: CreateDriverProfileInput,
  ): Promise<DriverProfileRecord> {
    if (this.uniqueCreateShouldFail) {
      return Promise.reject(driverProfileAlreadyExists());
    }
    if (
      [...this.profiles.values()].some((row) => row.accountId === accountId)
    ) {
      return Promise.reject(driverProfileAlreadyExists());
    }
    const row: DriverProfileRecord = {
      id: `driver-${accountId}`,
      accountId,
      fullName: input.fullName,
      verificationStatus: DRIVER_INITIAL_VERIFICATION_STATUS,
      approvedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.profiles.set(row.id, row);
    this.documents.set(row.id, []);
    this.vehicles.set(row.id, []);
    this.availability.set(row.id, {
      driverId: row.id,
      status: DRIVER_INITIAL_AVAILABILITY_STATUS,
      currentZoneId: null,
      offlineAfterCurrentDelivery: false,
      updatedAt: now(),
    });
    return Promise.resolve(row);
  }

  updateProfile(
    driverId: string,
    input: UpdateDriverProfileInput,
  ): Promise<DriverProfileRecord | null> {
    const row = this.profiles.get(driverId);
    if (!row) {
      return Promise.resolve(null);
    }
    const next = {
      ...row,
      fullName: input.fullName ?? row.fullName,
      updatedAt: now(),
    };
    this.profiles.set(driverId, next);
    return Promise.resolve(next);
  }

  setVerificationStatus(
    driverId: string,
    status: string,
    approvedAt: string | null,
  ): Promise<DriverProfileRecord | null> {
    const row = this.profiles.get(driverId);
    if (!row) {
      return Promise.resolve(null);
    }
    const next = {
      ...row,
      verificationStatus: status,
      approvedAt,
      updatedAt: now(),
    };
    this.profiles.set(driverId, next);
    return Promise.resolve(next);
  }

  listDocuments(driverId: string): Promise<DriverDocumentRecord[]> {
    return Promise.resolve([...(this.documents.get(driverId) ?? [])]);
  }

  upsertDocument(
    driverId: string,
    type: string,
    expiryDate: string | null,
  ): Promise<DriverDocumentRecord> {
    const rows = this.documents.get(driverId) ?? [];
    const current = rows.find((row) => row.type === type);
    if (current) {
      current.expiryDate = expiryDate;
      current.updatedAt = now();
      return Promise.resolve(current);
    }
    const created: DriverDocumentRecord = {
      id: `doc-${driverId}-${type}`,
      driverId,
      type,
      fileUrl: objectKeyForDocument(`doc-${driverId}-${type}`),
      status: DRIVER_DOCUMENT_STATUS_PENDING,
      expiryDate,
      createdAt: now(),
      updatedAt: now(),
    };
    this.documents.set(driverId, [...rows, created]);
    return Promise.resolve(created);
  }

  listVehicles(driverId: string): Promise<DriverVehicleRecord[]> {
    return Promise.resolve([...(this.vehicles.get(driverId) ?? [])]);
  }

  findOwnedVehicle(
    driverId: string,
    vehicleId: string,
  ): Promise<DriverVehicleRecord | null> {
    return Promise.resolve(
      (this.vehicles.get(driverId) ?? []).find((row) => row.id === vehicleId) ??
        null,
    );
  }

  createActiveVehicle(
    driverId: string,
    input: CreateVehicleInput,
  ): Promise<DriverVehicleRecord> {
    if (this.uniquePlateShouldFail) {
      return Promise.reject(driverVehicleConflict());
    }
    const rows = this.vehicles.get(driverId) ?? [];
    for (const row of rows) {
      row.status = DRIVER_VEHICLE_STATUS_INACTIVE;
    }
    const created: DriverVehicleRecord = {
      id: `vehicle-${driverId}-${rows.length + 1}`,
      driverId,
      type: input.type,
      plateNumber: input.plateNumber,
      model: input.model,
      color: input.color,
      status: DRIVER_VEHICLE_STATUS_ACTIVE,
      createdAt: now(),
      updatedAt: now(),
    };
    this.vehicles.set(driverId, [...rows, created]);
    return Promise.resolve(created);
  }

  updateVehicle(
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<DriverVehicleRecord | null> {
    for (const rows of this.vehicles.values()) {
      const row = rows.find((item) => item.id === vehicleId);
      if (!row) {
        continue;
      }
      Object.assign(row, {
        type: input.type ?? row.type,
        plateNumber: input.plateNumber ?? row.plateNumber,
        model: input.model ?? row.model,
        color: input.color === undefined ? row.color : input.color,
        updatedAt: now(),
      });
      return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  findAvailability(driverId: string): Promise<DriverAvailabilityRecord | null> {
    return Promise.resolve(this.availability.get(driverId) ?? null);
  }

  setAvailabilityStatus(
    driverId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<DriverAvailabilityRecord | null> {
    const row = this.availability.get(driverId);
    if (!row || row.status !== fromStatus) {
      return Promise.resolve(null);
    }
    const next = {
      ...row,
      status: toStatus,
      offlineAfterCurrentDelivery: false,
      updatedAt: now(),
    };
    this.availability.set(driverId, next);
    return Promise.resolve(next);
  }

  forceAvailabilityStatus(driverId: string, status: string): Promise<void> {
    const row = this.availability.get(driverId);
    if (row) {
      row.status = status;
      row.offlineAfterCurrentDelivery = false;
      row.updatedAt = now();
    }
    return Promise.resolve();
  }
}

describe('DriverService', () => {
  let repo: MemoryDriverRepository;
  let service: DriverService;
  let review: DriverReviewService;

  beforeEach(() => {
    repo = new MemoryDriverRepository();
    service = new DriverService(repo as never);
    review = new DriverReviewService(repo as never);
  });

  async function onboard(accountId = ACCOUNT_A): Promise<string> {
    await service.createProfile(accountId, { fullName: 'Ada Driver' });
    await service.upsertDocument(accountId, {
      type: DRIVER_DOCUMENT_IDENTITY,
      expiryDate: null,
    });
    await service.upsertDocument(accountId, {
      type: DRIVER_DOCUMENT_DRIVING_LICENSE,
      expiryDate: '2099-01-01',
    });
    await service.createVehicle(accountId, {
      type: 'MOTORCYCLE',
      plateNumber: 'ab 123 cd',
      model: 'NMAX',
      color: 'Black',
    });
    return (await repo.findProfileByAccountId(accountId))!.id;
  }

  it('bootstraps GET me without creating a profile', async () => {
    const me = await service.getMe(ACCOUNT_A);
    expect(me.driverProfileExists).toBe(false);
    expect(me.profile).toBeNull();
    expect(me.operationalReady).toBe(false);
  });

  it('creates one UNVERIFIED profile with OFFLINE availability', async () => {
    const created = await service.createProfile(ACCOUNT_A, {
      fullName: 'Ada Driver',
    });
    expect(created.verificationStatus).toBe('UNVERIFIED');
    expect(created.approvedAt).toBeNull();
    const me = await service.getMe(ACCOUNT_A);
    expect(me.availability?.status).toBe(DRIVER_AVAILABILITY_OFFLINE);
    expect(me.matchingEligible).toBe(false);
  });

  it('rejects duplicate create', async () => {
    await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
    try {
      await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
      throw new Error('expected duplicate');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS);
    }
  });

  it('maps concurrent unique profile create to already-exists', async () => {
    repo.uniqueCreateShouldFail = true;
    await expect(
      service.createProfile(ACCOUNT_A, { fullName: 'Ada' }),
    ).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS,
    });
  });

  it('does not accept injected status on create arity', () => {
    expect(service.createProfile.length).toBe(2);
  });

  it('blocks incomplete verification submit', async () => {
    await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
    try {
      await service.submitVerification(ACCOUNT_A);
      throw new Error('expected incomplete');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_DOCUMENT_REQUIRED);
    }
  });

  it('submits complete onboarding to PENDING_REVIEW and rejects repeat submit', async () => {
    await onboard();
    const submitted = await service.submitVerification(ACCOUNT_A);
    expect(submitted.profile?.verificationStatus).toBe(
      DRIVER_VERIFICATION_PENDING_REVIEW,
    );
    expect(submitted.verificationSubmitted).toBe(true);
    expect(submitted.operationalReady).toBe(false);
    try {
      await service.submitVerification(ACCOUNT_A);
      throw new Error('expected repeat conflict');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_VERIFICATION_INVALID_STATE);
    }
  });

  it('locks profile and documents after submit', async () => {
    await onboard();
    await service.submitVerification(ACCOUNT_A);
    try {
      await service.updateProfile(ACCOUNT_A, { fullName: 'Hacker' });
      throw new Error('expected lock');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_VERIFICATION_INVALID_STATE);
    }
  });

  it('cannot self-approve, self-reject, or self-suspend through public actions', () => {
    expect(Object.getOwnPropertyNames(DriverService.prototype)).not.toEqual(
      expect.arrayContaining(['approve', 'reject', 'suspend']),
    );
  });

  it('allows rejected correction and resubmit', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.reject(driverId);
    await service.updateProfile(ACCOUNT_A, { fullName: 'Ada Corrected' });
    const resubmitted = await service.submitVerification(ACCOUNT_A);
    expect(resubmitted.profile?.verificationStatus).toBe(
      DRIVER_VERIFICATION_PENDING_REVIEW,
    );
    expect(resubmitted.profile?.fullName).toBe('Ada Corrected');
  });

  it('approves via internal review and allows go-online / go-offline', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    const online = await service.goOnline(ACCOUNT_A);
    expect(online.availability?.status).toBe(DRIVER_AVAILABILITY_ONLINE);
    expect(online.matchingEligible).toBe(true);
    expect(await service.matchingEligibility(driverId)).toBe(true);
    const offline = await service.goOffline(ACCOUNT_A);
    expect(offline.availability?.status).toBe(DRIVER_AVAILABILITY_OFFLINE);
    expect(offline.matchingEligible).toBe(false);
  });

  it('blocks go-online for unapproved, rejected, and suspended drivers', async () => {
    await onboard();
    try {
      await service.goOnline(ACCOUNT_A);
      throw new Error('expected unapproved');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_NOT_APPROVED);
    }
    const driverId = (await repo.findProfileByAccountId(ACCOUNT_A))!.id;
    await service.submitVerification(ACCOUNT_A);
    await review.reject(driverId);
    await expect(service.goOnline(ACCOUNT_A)).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_NOT_APPROVED,
    });
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    await review.suspend(driverId);
    await expect(service.goOnline(ACCOUNT_A)).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_NOT_APPROVED,
    });
    expect(await service.matchingEligibility(driverId)).toBe(false);
  });

  it('keeps SUSPENDED self-read', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    await review.suspend(driverId);
    const me = await service.getMe(ACCOUNT_A);
    expect(me.driverProfileExists).toBe(true);
    expect(me.profile?.verificationStatus).toBe(DRIVER_VERIFICATION_SUSPENDED);
    expect(me.availability?.status).toBe('SUSPENDED');
  });

  it('hides foreign Driver data because ownership is account-scoped', async () => {
    await onboard(ACCOUNT_A);
    const foreign = await service.getMe(ACCOUNT_B);
    expect(foreign.driverProfileExists).toBe(false);
    try {
      await service.updateProfile(ACCOUNT_B, { fullName: 'Eve' });
      throw new Error('expected missing');
    } catch (error) {
      expectCode(error, DRIVER_ERROR_CODES.DRIVER_PROFILE_NOT_FOUND);
    }
  });

  it('normalizes plates and deactivates the previous ACTIVE vehicle', async () => {
    await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
    const first = await service.createVehicle(ACCOUNT_A, {
      type: 'MOTORCYCLE',
      plateNumber: 'aa 1',
      model: 'A',
      color: null,
    });
    expect(first.plateNumber).toBe('AA1');
    const second = await service.createVehicle(ACCOUNT_A, {
      type: 'CAR',
      plateNumber: 'bb 2',
      model: 'B',
      color: null,
    });
    const me = await service.getMe(ACCOUNT_A);
    expect(second.status).toBe(DRIVER_VEHICLE_STATUS_ACTIVE);
    expect(me.vehicles.find((vehicle) => vehicle.id === first.id)?.status).toBe(
      DRIVER_VEHICLE_STATUS_INACTIVE,
    );
  });

  it('does not return document object keys', async () => {
    await onboard();
    const me = await service.getMe(ACCOUNT_A);
    expect(me.documents.every((document) => document.present)).toBe(true);
    expect(JSON.stringify(me)).not.toContain('sg-object:');
    expect(JSON.stringify(me)).not.toContain('fileUrl');
  });

  it('maps ACTIVE plate uniqueness to DRIVER_VEHICLE_CONFLICT', async () => {
    await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
    repo.uniquePlateShouldFail = true;
    await expect(
      service.createVehicle(ACCOUNT_A, {
        type: 'MOTORCYCLE',
        plateNumber: 'DUP1',
        model: 'NMAX',
        color: null,
      }),
    ).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_VEHICLE_CONFLICT,
    });
  });

  it('rejects an already-expired identity expiryDate', async () => {
    await service.createProfile(ACCOUNT_A, { fullName: 'Ada' });
    await expect(
      service.upsertDocument(ACCOUNT_A, {
        type: DRIVER_DOCUMENT_IDENTITY,
        expiryDate: '2000-01-01',
      }),
    ).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_DOCUMENT_INVALID,
    });
  });

  it('keeps APPROVED after license expiry but removes operational eligibility', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    await service.goOnline(ACCOUNT_A);
    const license = (repo.documents.get(driverId) ?? []).find(
      (document) => document.type === DRIVER_DOCUMENT_DRIVING_LICENSE,
    );
    license!.expiryDate = '2000-01-01';
    const me = await service.getMe(ACCOUNT_A);
    expect(me.profile?.verificationStatus).toBe('APPROVED');
    expect(me.availability?.status).toBe(DRIVER_AVAILABILITY_ONLINE);
    expect(me.drivingLicenseComplete).toBe(false);
    expect(me.operationalReady).toBe(false);
    expect(me.matchingEligible).toBe(false);
    expect(await service.matchingEligibility(driverId)).toBe(false);
  });

  it('blocks go-online when an APPROVED license has expired', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    const license = (repo.documents.get(driverId) ?? []).find(
      (document) => document.type === DRIVER_DOCUMENT_DRIVING_LICENSE,
    );
    license!.expiryDate = '2000-01-01';
    await expect(service.goOnline(ACCOUNT_A)).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_NOT_OPERATIONAL,
    });
  });

  it('fails identity completeness when a present identity expiry is expired', async () => {
    const driverId = await onboard();
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    const identity = (repo.documents.get(driverId) ?? []).find(
      (document) => document.type === DRIVER_DOCUMENT_IDENTITY,
    );
    identity!.expiryDate = '2000-01-01';
    const me = await service.getMe(ACCOUNT_A);
    expect(me.profile?.verificationStatus).toBe('APPROVED');
    expect(me.identityDocumentComplete).toBe(false);
    expect(me.operationalReady).toBe(false);
    expect(me.matchingEligible).toBe(false);
  });

  it('treats pending, rejected, and missing vehicle as not matching-eligible', async () => {
    const driverId = await onboard();
    expect(await service.matchingEligibility(driverId)).toBe(false);
    await service.submitVerification(ACCOUNT_A);
    expect(await service.matchingEligibility(driverId)).toBe(false);
    await review.reject(driverId);
    expect(await service.matchingEligibility(driverId)).toBe(false);
    await service.submitVerification(ACCOUNT_A);
    await review.approve(driverId);
    repo.vehicles.set(driverId, []);
    expect(await service.matchingEligibility(driverId)).toBe(false);
  });
});
