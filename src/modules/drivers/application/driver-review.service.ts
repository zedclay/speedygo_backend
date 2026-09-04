import { Injectable } from '@nestjs/common';
import {
  pgNow,
  pgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import {
  driverProfileNotFound,
  driverVerificationInvalidState,
} from '../domain/driver.errors';
import {
  DRIVER_AVAILABILITY_OFFLINE,
  DRIVER_AVAILABILITY_SUSPENDED,
  DRIVER_VERIFICATION_APPROVED,
  DRIVER_VERIFICATION_PENDING_REVIEW,
  DRIVER_VERIFICATION_REJECTED,
  DRIVER_VERIFICATION_SUSPENDED,
} from '../domain/driver.policy';
import type { DriverProfileView } from '../domain/driver.types';
import { toProfileView } from '../domain/driver.types';
import {
  DriverRepository,
  type OrmClient,
} from '../infrastructure/driver.repository';

/**
 * Internal review boundary for Admin Foundation / tests.
 * Not exposed as HTTP.
 *
 * InTx methods run inside a caller-provided transaction (Admin atomic
 * mutation+audit, or public wrappers that open their own TX).
 */
@Injectable()
export class DriverReviewService {
  constructor(private readonly drivers: DriverRepository) {}

  async approve(driverId: string): Promise<DriverProfileView> {
    return this.drivers.runInTransaction((tx) =>
      this.approveInTx(tx, driverId),
    );
  }

  async approveInTx(
    tx: OrmClient,
    driverId: string,
  ): Promise<DriverProfileView> {
    return this.transitionInTx(
      tx,
      driverId,
      DRIVER_VERIFICATION_PENDING_REVIEW,
      DRIVER_VERIFICATION_APPROVED,
      pgNow(),
    );
  }

  async reject(driverId: string): Promise<DriverProfileView> {
    return this.drivers.runInTransaction((tx) => this.rejectInTx(tx, driverId));
  }

  async rejectInTx(
    tx: OrmClient,
    driverId: string,
  ): Promise<DriverProfileView> {
    return this.transitionInTx(
      tx,
      driverId,
      DRIVER_VERIFICATION_PENDING_REVIEW,
      DRIVER_VERIFICATION_REJECTED,
      null,
    );
  }

  async suspend(driverId: string): Promise<DriverProfileView> {
    return this.drivers.runInTransaction((tx) =>
      this.suspendInTx(tx, driverId),
    );
  }

  async suspendInTx(
    tx: OrmClient,
    driverId: string,
  ): Promise<DriverProfileView> {
    const locked = await this.drivers.lockProfile(driverId, tx);
    if (!locked) {
      throw driverProfileNotFound();
    }
    if (locked.verificationStatus !== DRIVER_VERIFICATION_APPROVED) {
      throw driverVerificationInvalidState();
    }
    const updated = await this.drivers.setVerificationStatus(
      driverId,
      DRIVER_VERIFICATION_SUSPENDED,
      locked.approvedAt ? pgTimestamptz(locked.approvedAt) : null,
      tx,
    );
    await this.drivers.forceAvailabilityStatus(
      driverId,
      DRIVER_AVAILABILITY_SUSPENDED,
      tx,
    );
    if (!updated) {
      throw driverProfileNotFound();
    }
    return toProfileView(updated);
  }

  private async transitionInTx(
    tx: OrmClient,
    driverId: string,
    fromStatus: string,
    toStatus: string,
    approvedAt: ReturnType<typeof pgNow> | null,
  ): Promise<DriverProfileView> {
    const locked = await this.drivers.lockProfile(driverId, tx);
    if (!locked) {
      throw driverProfileNotFound();
    }
    if (locked.verificationStatus !== fromStatus) {
      throw driverVerificationInvalidState();
    }
    const updated = await this.drivers.setVerificationStatus(
      driverId,
      toStatus,
      approvedAt,
      tx,
    );
    if (toStatus === DRIVER_VERIFICATION_REJECTED) {
      await this.drivers.forceAvailabilityStatus(
        driverId,
        DRIVER_AVAILABILITY_OFFLINE,
        tx,
      );
    }
    if (!updated) {
      throw driverProfileNotFound();
    }
    return toProfileView(updated);
  }
}
