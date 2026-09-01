import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgDate,
  pgNow,
  pgVarchar,
  type PgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import {
  driverProfileAlreadyExists,
  driverVehicleConflict,
} from '../domain/driver.errors';
import {
  DRIVER_AVAILABILITY_STATUSES,
  DRIVER_DOCUMENT_STATUS_PENDING,
  DRIVER_INITIAL_AVAILABILITY_STATUS,
  DRIVER_INITIAL_VERIFICATION_STATUS,
  DRIVER_VEHICLE_STATUS_ACTIVE,
  DRIVER_VEHICLE_STATUS_INACTIVE,
  objectKeyForDocument,
  type DriverAvailabilityStatus,
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

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

function asAvailabilityStatus(status: string): DriverAvailabilityStatus {
  if (!(DRIVER_AVAILABILITY_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Unsupported driver availability status: ${status}`);
  }
  return status as DriverAvailabilityStatus;
}

@Injectable()
export class DriverRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction((tx) => fn(tx));
  }

  async findProfileByAccountId(
    accountId: string,
    client?: OrmClient,
  ): Promise<DriverProfileRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverProfile.where({ accountId })
      .first();
    return row ? this.toProfile(row) : null;
  }

  async findProfileById(
    driverId: string,
    client?: OrmClient,
  ): Promise<DriverProfileRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverProfile.where({ id: driverId })
      .first();
    return row ? this.toProfile(row) : null;
  }

  async lockProfile(
    driverId: string,
    client: OrmClient,
  ): Promise<DriverProfileRecord | null> {
    await orm(client).DriverProfile.where({ id: driverId }).update({
      updatedAt: pgNow(),
    });
    return this.findProfileById(driverId, client);
  }

  async createProfileWithAvailability(
    accountId: string,
    input: CreateDriverProfileInput,
  ): Promise<DriverProfileRecord> {
    const now = pgNow();
    const driverId = createUuidV7();
    try {
      return await this.runInTransaction(async (tx) => {
        const profile = await orm(tx).DriverProfile.create({
          id: driverId,
          accountId,
          fullName: pgVarchar<255>(input.fullName),
          verificationStatus: pgVarchar<64>(DRIVER_INITIAL_VERIFICATION_STATUS),
          approvedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        await orm(tx).DriverAvailability.create({
          driverId,
          status: DRIVER_INITIAL_AVAILABILITY_STATUS,
          currentZoneId: null,
          offlineAfterCurrentDelivery: false,
          updatedAt: now,
        });
        return this.toProfile(profile);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw driverProfileAlreadyExists();
      }
      throw error;
    }
  }

  async updateProfile(
    driverId: string,
    input: UpdateDriverProfileInput,
    client?: OrmClient,
  ): Promise<DriverProfileRecord | null> {
    const patch: {
      fullName?: ReturnType<typeof pgVarchar<255>>;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.fullName !== undefined) {
      patch.fullName = pgVarchar<255>(input.fullName);
    }
    await orm(client ?? this.db())
      .DriverProfile.where({ id: driverId })
      .update(patch);
    return this.findProfileById(driverId, client);
  }

  async setVerificationStatus(
    driverId: string,
    status: string,
    approvedAt: PgTimestamptz | null,
    client: OrmClient,
  ): Promise<DriverProfileRecord | null> {
    await orm(client)
      .DriverProfile.where({ id: driverId })
      .update({
        verificationStatus: pgVarchar<64>(status),
        approvedAt,
        updatedAt: pgNow(),
      });
    return this.findProfileById(driverId, client);
  }

  async listDocuments(
    driverId: string,
    client?: OrmClient,
  ): Promise<DriverDocumentRecord[]> {
    const rows = await orm(client ?? this.db())
      .DriverDocument.where({ driverId })
      .all();
    return rows.map((row) => this.toDocument(row));
  }

  async upsertDocument(
    driverId: string,
    type: string,
    expiryDate: string | null,
    client: OrmClient,
  ): Promise<DriverDocumentRecord> {
    const now = pgNow();
    const existing = await orm(client).DriverDocument.where({ driverId }).all();
    const current = existing.find((row) => row.type === type);
    if (current) {
      await orm(client)
        .DriverDocument.where({ id: current.id })
        .update({
          expiryDate: expiryDate ? pgDate(expiryDate) : null,
          updatedAt: now,
        });
      const row = await orm(client)
        .DriverDocument.where({ id: current.id })
        .first();
      return this.toDocument(row!);
    }
    const id = createUuidV7();
    const created = await orm(client).DriverDocument.create({
      id,
      driverId,
      type: pgVarchar<64>(type),
      fileUrl: objectKeyForDocument(id),
      status: pgVarchar<64>(DRIVER_DOCUMENT_STATUS_PENDING),
      expiryDate: expiryDate ? pgDate(expiryDate) : null,
      createdAt: now,
      updatedAt: now,
    });
    return this.toDocument(created);
  }

  async listVehicles(
    driverId: string,
    client?: OrmClient,
  ): Promise<DriverVehicleRecord[]> {
    const rows = await orm(client ?? this.db())
      .Vehicle.where({ driverId })
      .orderBy((vehicle) => vehicle.createdAt.asc())
      .all();
    return rows.map((row) => this.toVehicle(row));
  }

  async findOwnedVehicle(
    driverId: string,
    vehicleId: string,
    client?: OrmClient,
  ): Promise<DriverVehicleRecord | null> {
    const row = await orm(client ?? this.db())
      .Vehicle.where({ id: vehicleId, driverId })
      .first();
    return row ? this.toVehicle(row) : null;
  }

  async createActiveVehicle(
    driverId: string,
    input: CreateVehicleInput,
    client: OrmClient,
  ): Promise<DriverVehicleRecord> {
    const now = pgNow();
    await this.deactivateVehicles(driverId, client, now);
    try {
      const created = await orm(client).Vehicle.create({
        id: createUuidV7(),
        driverId,
        type: pgVarchar<64>(input.type),
        plateNumber: pgVarchar<32>(input.plateNumber),
        model: pgVarchar<128>(input.model),
        color: input.color ? pgVarchar<64>(input.color) : null,
        status: pgVarchar<64>(DRIVER_VEHICLE_STATUS_ACTIVE),
        createdAt: now,
        updatedAt: now,
      });
      await this.assertExactlyOneActiveVehicle(driverId, client);
      return this.toVehicle(created);
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw driverVehicleConflict();
      }
      throw error;
    }
  }

  async updateVehicle(
    vehicleId: string,
    input: UpdateVehicleInput,
    client: OrmClient,
  ): Promise<DriverVehicleRecord | null> {
    const patch: {
      type?: ReturnType<typeof pgVarchar<64>>;
      plateNumber?: ReturnType<typeof pgVarchar<32>>;
      model?: ReturnType<typeof pgVarchar<128>>;
      color?: ReturnType<typeof pgVarchar<64>> | null;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.type !== undefined) {
      patch.type = pgVarchar<64>(input.type);
    }
    if (input.plateNumber !== undefined) {
      patch.plateNumber = pgVarchar<32>(input.plateNumber);
    }
    if (input.model !== undefined) {
      patch.model = pgVarchar<128>(input.model);
    }
    if (input.color !== undefined) {
      patch.color = input.color ? pgVarchar<64>(input.color) : null;
    }
    try {
      await orm(client).Vehicle.where({ id: vehicleId }).update(patch);
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw driverVehicleConflict();
      }
      throw error;
    }
    const row = await orm(client).Vehicle.where({ id: vehicleId }).first();
    return row ? this.toVehicle(row) : null;
  }

  async findAvailability(
    driverId: string,
    client?: OrmClient,
  ): Promise<DriverAvailabilityRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverAvailability.where({ driverId })
      .first();
    return row ? this.toAvailability(row) : null;
  }

  async setAvailabilityStatus(
    driverId: string,
    fromStatus: string,
    toStatus: string,
    client: OrmClient,
  ): Promise<DriverAvailabilityRecord | null> {
    const now = pgNow();
    await orm(client)
      .DriverAvailability.where({
        driverId,
        status: asAvailabilityStatus(fromStatus),
      })
      .update({
        status: asAvailabilityStatus(toStatus),
        offlineAfterCurrentDelivery: false,
        updatedAt: now,
      });
    const row = await orm(client)
      .DriverAvailability.where({ driverId })
      .first();
    if (!row || row.status !== toStatus) {
      return null;
    }
    return this.toAvailability(row);
  }

  async forceAvailabilityStatus(
    driverId: string,
    status: string,
    client: OrmClient,
  ): Promise<void> {
    await orm(client)
      .DriverAvailability.where({ driverId })
      .update({
        status: asAvailabilityStatus(status),
        offlineAfterCurrentDelivery: false,
        updatedAt: pgNow(),
      });
  }

  private async deactivateVehicles(
    driverId: string,
    client: OrmClient,
    now: ReturnType<typeof pgNow>,
  ): Promise<void> {
    await orm(client)
      .Vehicle.where({
        driverId,
        status: pgVarchar<64>(DRIVER_VEHICLE_STATUS_ACTIVE),
      })
      .update({
        status: pgVarchar<64>(DRIVER_VEHICLE_STATUS_INACTIVE),
        updatedAt: now,
      });
  }

  private async assertExactlyOneActiveVehicle(
    driverId: string,
    client: OrmClient,
  ): Promise<void> {
    const active = (await this.listVehicles(driverId, client)).filter(
      (vehicle) => vehicle.status === DRIVER_VEHICLE_STATUS_ACTIVE,
    );
    if (active.length !== 1) {
      throw new Error('Driver must have exactly one ACTIVE vehicle');
    }
  }

  private toProfile(row: {
    id: string;
    accountId: string;
    fullName: string;
    verificationStatus: string;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): DriverProfileRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      fullName: row.fullName,
      verificationStatus: row.verificationStatus,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDocument(row: {
    id: string;
    driverId: string;
    type: string;
    fileUrl: string;
    status: string;
    expiryDate: string | null;
    createdAt: string;
    updatedAt: string;
  }): DriverDocumentRecord {
    return {
      id: row.id,
      driverId: row.driverId,
      type: row.type,
      fileUrl: row.fileUrl,
      status: row.status,
      expiryDate: row.expiryDate,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toVehicle(row: {
    id: string;
    driverId: string;
    type: string;
    plateNumber: string;
    model: string;
    color: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }): DriverVehicleRecord {
    return {
      id: row.id,
      driverId: row.driverId,
      type: row.type,
      plateNumber: row.plateNumber,
      model: row.model,
      color: row.color,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toAvailability(row: {
    driverId: string;
    status: string;
    currentZoneId: string | null;
    offlineAfterCurrentDelivery: boolean;
    updatedAt: string;
  }): DriverAvailabilityRecord {
    return {
      driverId: row.driverId,
      status: row.status,
      currentZoneId: row.currentZoneId,
      offlineAfterCurrentDelivery: row.offlineAfterCurrentDelivery,
      updatedAt: row.updatedAt,
    };
  }
}
