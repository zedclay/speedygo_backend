import { Injectable } from '@nestjs/common';
import {
  driverAvailabilityInvalidTransition,
  driverDocumentInvalid,
  driverDocumentRequired,
  driverLicenseRequired,
  driverNotApproved,
  driverNotOperational,
  driverOnboardingIncomplete,
  driverProfileAlreadyExists,
  driverProfileNotFound,
  driverVehicleNotFound,
  driverVehicleRequired,
  driverVerificationInvalidState,
} from '../domain/driver.errors';
import {
  canGoOnline,
  canParticipateInMatching,
  canSubmitVerification,
  DRIVER_AVAILABILITY_OFFLINE,
  DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY,
  DRIVER_AVAILABILITY_ONLINE,
  DRIVER_AVAILABILITY_SUSPENDED,
  DRIVER_DOCUMENT_DRIVING_LICENSE,
  DRIVER_DOCUMENT_IDENTITY,
  DRIVER_VERIFICATION_APPROVED,
  DRIVER_VERIFICATION_PENDING_REVIEW,
  isDriverDocumentType,
  isDriverVehicleType,
  isDrivingLicenseComplete,
  isEditableOnboardingStatus,
  isExpiryValid,
  isIdentityDocumentComplete,
  isIsoDate,
  isOnboardingReady,
  isOperationalReady,
  isProfileComplete,
  normalizePlate,
} from '../domain/driver.policy';
import type {
  CreateDriverProfileInput,
  CreateVehicleInput,
  DriverAvailabilityRecord,
  DriverDocumentRecord,
  DriverMeView,
  DriverProfileRecord,
  DriverProfileView,
  DriverReadinessView,
  DriverVehicleRecord,
  DriverVehicleView,
  UpdateDriverProfileInput,
  UpdateVehicleInput,
  UpsertDocumentInput,
} from '../domain/driver.types';
import {
  toAvailabilityView,
  toDocumentView,
  toProfileView,
  toVehicleView,
} from '../domain/driver.types';
import { DriverRepository } from '../infrastructure/driver.repository';

@Injectable()
export class DriverService {
  constructor(private readonly drivers: DriverRepository) {}

  async getMe(accountId: string): Promise<DriverMeView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      return {
        driverProfileExists: false,
        profileComplete: false,
        identityDocumentComplete: false,
        drivingLicenseComplete: false,
        vehicleComplete: false,
        verificationSubmitted: false,
        verificationApproved: false,
        operationalReady: false,
        matchingEligible: false,
        profile: null,
        documents: [],
        vehicles: [],
        availability: null,
      };
    }
    const [documents, vehicles, availability] = await Promise.all([
      this.drivers.listDocuments(profile.id),
      this.drivers.listVehicles(profile.id),
      this.drivers.findAvailability(profile.id),
    ]);
    return this.toMe(profile, documents, vehicles, availability);
  }

  async createProfile(
    accountId: string,
    input: CreateDriverProfileInput,
  ): Promise<DriverProfileView> {
    const existing = await this.drivers.findProfileByAccountId(accountId);
    if (existing) {
      throw driverProfileAlreadyExists();
    }
    const created = await this.drivers.createProfileWithAvailability(
      accountId,
      { fullName: input.fullName.trim() },
    );
    return toProfileView(created);
  }

  async updateProfile(
    accountId: string,
    input: UpdateDriverProfileInput,
  ): Promise<DriverProfileView> {
    const profile = await this.requireEditableProfile(accountId);
    const updated = await this.drivers.updateProfile(profile.id, {
      fullName: input.fullName?.trim(),
    });
    if (!updated) {
      throw driverProfileNotFound();
    }
    return toProfileView(updated);
  }

  async upsertDocument(
    accountId: string,
    input: UpsertDocumentInput,
  ): Promise<DriverMeView> {
    if (!isDriverDocumentType(input.type)) {
      throw driverDocumentInvalid('Unsupported document type');
    }
    if (input.type === DRIVER_DOCUMENT_DRIVING_LICENSE) {
      if (!input.expiryDate || !isIsoDate(input.expiryDate)) {
        throw driverDocumentInvalid('Driving license expiryDate is required');
      }
      if (!isExpiryValid(input.expiryDate)) {
        throw driverDocumentInvalid('Driving license has expired');
      }
    } else if (input.expiryDate) {
      if (!isIsoDate(input.expiryDate)) {
        throw driverDocumentInvalid('expiryDate must be YYYY-MM-DD');
      }
      if (!isExpiryValid(input.expiryDate)) {
        throw driverDocumentInvalid('Identity document has expired');
      }
    }
    const profile = await this.requireEditableProfile(accountId);
    await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(profile.id, tx);
      if (!locked || !isEditableOnboardingStatus(locked.verificationStatus)) {
        throw driverVerificationInvalidState();
      }
      await this.drivers.upsertDocument(
        locked.id,
        input.type,
        input.expiryDate,
        tx,
      );
    });
    return this.getMe(accountId);
  }

  async createVehicle(
    accountId: string,
    input: CreateVehicleInput,
  ): Promise<DriverVehicleView> {
    if (!isDriverVehicleType(input.type)) {
      throw driverDocumentInvalid('Unsupported vehicle type');
    }
    const profile = await this.requireEditableProfile(accountId);
    const plateNumber = normalizePlate(input.plateNumber);
    const created = await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(profile.id, tx);
      if (!locked || !isEditableOnboardingStatus(locked.verificationStatus)) {
        throw driverVerificationInvalidState();
      }
      return this.drivers.createActiveVehicle(
        locked.id,
        {
          type: input.type,
          plateNumber,
          model: input.model.trim(),
          color: input.color?.trim() ?? null,
        },
        tx,
      );
    });
    return toVehicleView(created);
  }

  async updateVehicle(
    accountId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<DriverVehicleView> {
    if (input.type !== undefined && !isDriverVehicleType(input.type)) {
      throw driverDocumentInvalid('Unsupported vehicle type');
    }
    const profile = await this.requireEditableProfile(accountId);
    const updated = await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(profile.id, tx);
      if (!locked || !isEditableOnboardingStatus(locked.verificationStatus)) {
        throw driverVerificationInvalidState();
      }
      const owned = await this.drivers.findOwnedVehicle(
        locked.id,
        vehicleId,
        tx,
      );
      if (!owned) {
        throw driverVehicleNotFound();
      }
      return this.drivers.updateVehicle(
        vehicleId,
        {
          type: input.type,
          plateNumber:
            input.plateNumber !== undefined
              ? normalizePlate(input.plateNumber)
              : undefined,
          model: input.model?.trim(),
          color:
            input.color === undefined
              ? undefined
              : (input.color?.trim() ?? null),
        },
        tx,
      );
    });
    if (!updated) {
      throw driverVehicleNotFound();
    }
    return toVehicleView(updated);
  }

  async submitVerification(accountId: string): Promise<DriverMeView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(profile.id, tx);
      if (!locked) {
        throw driverProfileNotFound();
      }
      if (locked.verificationStatus === DRIVER_VERIFICATION_PENDING_REVIEW) {
        throw driverVerificationInvalidState();
      }
      if (!canSubmitVerification(locked.verificationStatus)) {
        throw driverVerificationInvalidState();
      }
      const documents = await this.drivers.listDocuments(locked.id, tx);
      const vehicles = await this.drivers.listVehicles(locked.id, tx);
      this.assertOnboardingComplete(locked.fullName, documents, vehicles);
      await this.drivers.setVerificationStatus(
        locked.id,
        DRIVER_VERIFICATION_PENDING_REVIEW,
        null,
        tx,
      );
    });
    return this.getMe(accountId);
  }

  async goOnline(accountId: string): Promise<DriverMeView> {
    const snapshot = await this.requireProfileSnapshot(accountId);
    if (!isOperationalReady(snapshot.readinessInput)) {
      if (
        snapshot.profile.verificationStatus !== DRIVER_VERIFICATION_APPROVED
      ) {
        throw driverNotApproved();
      }
      throw driverNotOperational();
    }
    if (
      !canGoOnline({
        verificationStatus: snapshot.profile.verificationStatus,
        availabilityStatus: snapshot.availability?.status ?? '',
        operationalReady: true,
      })
    ) {
      throw driverAvailabilityInvalidTransition();
    }
    await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(snapshot.profile.id, tx);
      if (!locked) {
        throw driverProfileNotFound();
      }
      const documents = await this.drivers.listDocuments(locked.id, tx);
      const vehicles = await this.drivers.listVehicles(locked.id, tx);
      const availability = await this.drivers.findAvailability(locked.id, tx);
      const ready = this.readiness(locked, documents, vehicles, availability);
      if (!ready.operationalReady) {
        throw driverNotOperational();
      }
      const moved = await this.drivers.setAvailabilityStatus(
        locked.id,
        DRIVER_AVAILABILITY_OFFLINE,
        DRIVER_AVAILABILITY_ONLINE,
        tx,
      );
      if (!moved) {
        throw driverAvailabilityInvalidTransition();
      }
    });
    return this.getMe(accountId);
  }

  async goOffline(accountId: string): Promise<DriverMeView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    await this.drivers.runInTransaction(async (tx) => {
      const locked = await this.drivers.lockProfile(profile.id, tx);
      if (!locked) {
        throw driverProfileNotFound();
      }
      const availability = await this.drivers.findAvailability(locked.id, tx);
      if (!availability) {
        throw driverAvailabilityInvalidTransition();
      }
      if (availability.status === DRIVER_AVAILABILITY_OFFLINE) {
        throw driverAvailabilityInvalidTransition();
      }
      if (availability.status === DRIVER_AVAILABILITY_SUSPENDED) {
        throw driverAvailabilityInvalidTransition();
      }
      if (
        availability.status ===
        DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY
      ) {
        throw driverAvailabilityInvalidTransition();
      }
      const accepted = await this.drivers.findOpenAcceptedAssignment(
        locked.id,
        tx,
      );
      const nextStatus = accepted
        ? DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY
        : DRIVER_AVAILABILITY_OFFLINE;
      const moved = await this.drivers.setAvailabilityStatus(
        locked.id,
        availability.status,
        nextStatus,
        tx,
      );
      if (!moved) {
        throw driverAvailabilityInvalidTransition();
      }
    });
    return this.getMe(accountId);
  }

  async matchingEligibility(driverId: string): Promise<boolean> {
    const profile = await this.drivers.findProfileById(driverId);
    if (!profile) {
      return false;
    }
    const [documents, vehicles, availability] = await Promise.all([
      this.drivers.listDocuments(profile.id),
      this.drivers.listVehicles(profile.id),
      this.drivers.findAvailability(profile.id),
    ]);
    return this.readiness(profile, documents, vehicles, availability)
      .matchingEligible;
  }

  private async requireEditableProfile(
    accountId: string,
  ): Promise<DriverProfileRecord> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    if (!isEditableOnboardingStatus(profile.verificationStatus)) {
      throw driverVerificationInvalidState();
    }
    return profile;
  }

  private async requireProfileSnapshot(accountId: string): Promise<{
    profile: DriverProfileRecord;
    documents: DriverDocumentRecord[];
    vehicles: DriverVehicleRecord[];
    availability: DriverAvailabilityRecord | null;
    readinessInput: {
      verificationStatus: string;
      fullName: string;
      identity: { type: string; expiryDate: string | null } | null;
      license: { type: string; expiryDate: string | null } | null;
      vehicles: Array<{ status: string }>;
    };
  }> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    const [documents, vehicles, availability] = await Promise.all([
      this.drivers.listDocuments(profile.id),
      this.drivers.listVehicles(profile.id),
      this.drivers.findAvailability(profile.id),
    ]);
    return {
      profile,
      documents,
      vehicles,
      availability,
      readinessInput: this.readinessInput(profile, documents, vehicles),
    };
  }

  private assertOnboardingComplete(
    fullName: string,
    documents: DriverDocumentRecord[],
    vehicles: DriverVehicleRecord[],
  ): void {
    const identity = documents.find(
      (document) => document.type === DRIVER_DOCUMENT_IDENTITY,
    );
    const license = documents.find(
      (document) => document.type === DRIVER_DOCUMENT_DRIVING_LICENSE,
    );
    if (!isProfileComplete(fullName)) {
      throw driverOnboardingIncomplete();
    }
    if (!identity || !isIdentityDocumentComplete(identity)) {
      throw driverDocumentRequired();
    }
    if (!license || !isExpiryValid(license.expiryDate)) {
      throw driverLicenseRequired();
    }
    if (!vehicles.some((vehicle) => vehicle.status === 'ACTIVE')) {
      throw driverVehicleRequired();
    }
    if (
      !isOnboardingReady({
        fullName,
        identity,
        license,
        vehicles,
      })
    ) {
      throw driverOnboardingIncomplete();
    }
  }

  private toMe(
    profile: DriverProfileRecord,
    documents: DriverDocumentRecord[],
    vehicles: DriverVehicleRecord[],
    availability: DriverAvailabilityRecord | null,
  ): DriverMeView {
    const ready = this.readiness(profile, documents, vehicles, availability);
    return {
      driverProfileExists: true,
      ...ready,
      profile: toProfileView(profile),
      documents: documents.map(toDocumentView),
      vehicles: vehicles.map(toVehicleView),
      availability: availability ? toAvailabilityView(availability) : null,
    };
  }

  private readiness(
    profile: DriverProfileRecord,
    documents: DriverDocumentRecord[],
    vehicles: DriverVehicleRecord[],
    availability: DriverAvailabilityRecord | null,
  ): DriverReadinessView {
    const input = this.readinessInput(profile, documents, vehicles);
    const operationalReady = isOperationalReady(input);
    return {
      profileComplete: isProfileComplete(profile.fullName),
      identityDocumentComplete: isIdentityDocumentComplete(input.identity),
      drivingLicenseComplete: isDrivingLicenseComplete(input.license),
      vehicleComplete: input.vehicles.some(
        (vehicle) => vehicle.status === 'ACTIVE',
      ),
      verificationSubmitted:
        profile.verificationStatus === DRIVER_VERIFICATION_PENDING_REVIEW ||
        profile.verificationStatus === DRIVER_VERIFICATION_APPROVED,
      verificationApproved:
        profile.verificationStatus === DRIVER_VERIFICATION_APPROVED,
      operationalReady,
      matchingEligible: canParticipateInMatching({
        verificationStatus: profile.verificationStatus,
        availabilityStatus: availability?.status ?? '',
        operationalReady,
      }),
    };
  }

  private readinessInput(
    profile: DriverProfileRecord,
    documents: DriverDocumentRecord[],
    vehicles: DriverVehicleRecord[],
  ) {
    return {
      verificationStatus: profile.verificationStatus,
      fullName: profile.fullName,
      identity:
        documents.find(
          (document) => document.type === DRIVER_DOCUMENT_IDENTITY,
        ) ?? null,
      license:
        documents.find(
          (document) => document.type === DRIVER_DOCUMENT_DRIVING_LICENSE,
        ) ?? null,
      vehicles,
    };
  }
}
