import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgNumeric,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  customerDefaultAddressInvalid,
  customerProfileAlreadyExists,
} from '../domain/customer.errors';
import type {
  AddressRecord,
  CreateAddressInput,
  CreateProfileInput,
  CustomerProfileRecord,
  UpdateAddressInput,
  UpdateProfileInput,
} from '../domain/customer.types';

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

function parseCoordinate(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

async function withUniqueRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isPostgresUniqueViolation(error) || attempt === 2) {
        throw error;
      }
    }
  }
  throw lastError;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findProfileByAccountId(
    accountId: string,
  ): Promise<CustomerProfileRecord | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row ? this.toProfile(row) : null;
  }

  async createProfile(
    accountId: string,
    input: CreateProfileInput,
  ): Promise<CustomerProfileRecord> {
    const now = pgNow();
    try {
      const row = await orm(this.db()).CustomerProfile.create({
        id: createUuidV7(),
        accountId,
        fullName: pgVarchar<255>(input.fullName),
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      });
      return this.toProfile(row);
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw customerProfileAlreadyExists();
      }
      throw error;
    }
  }

  async updateProfile(
    profileId: string,
    input: UpdateProfileInput,
  ): Promise<CustomerProfileRecord | null> {
    const patch: {
      fullName?: ReturnType<typeof pgVarchar<255>>;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.fullName !== undefined) {
      patch.fullName = pgVarchar<255>(input.fullName);
    }
    await orm(this.db()).CustomerProfile.where({ id: profileId }).update(patch);
    const row = await orm(this.db())
      .CustomerProfile.where({ id: profileId })
      .first();
    return row ? this.toProfile(row) : null;
  }

  async listAddresses(customerId: string): Promise<AddressRecord[]> {
    const rows = await orm(this.db())
      .Address.where({ customerId })
      .orderBy((address) => address.createdAt.asc())
      .all();
    return rows.map((row) => this.toAddress(row));
  }

  async findOwnedAddress(
    customerId: string,
    addressId: string,
  ): Promise<AddressRecord | null> {
    const row = await orm(this.db())
      .Address.where({ id: addressId, customerId })
      .first();
    return row ? this.toAddress(row) : null;
  }

  async createAddress(
    customerId: string,
    input: CreateAddressInput,
  ): Promise<AddressRecord> {
    try {
      return await withUniqueRetry(async () => {
        const db = this.db();
        return db.transaction(async (tx) => {
          const existing = await orm(tx)
            .Address.where({ customerId })
            .select('id')
            .all();
          const isFirst = existing.length === 0;
          return this.toAddress(
            await orm(tx).Address.create(
              this.addressCreatePayload(customerId, input, isFirst),
            ),
          );
        });
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw customerDefaultAddressInvalid();
      }
      throw error;
    }
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<AddressRecord | null> {
    const existing = await this.findOwnedAddress(customerId, addressId);
    if (!existing) {
      return null;
    }
    const patch: {
      label?: ReturnType<typeof pgVarchar<64>>;
      addressText?: string;
      latitude?: ReturnType<typeof pgNumeric<9, 6>>;
      longitude?: ReturnType<typeof pgNumeric<9, 6>>;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.label !== undefined) {
      patch.label = pgVarchar<64>(input.label);
    }
    if (input.addressText !== undefined) {
      patch.addressText = input.addressText;
    }
    if (input.latitude !== undefined) {
      patch.latitude = pgNumeric<9, 6>(input.latitude, 6);
    }
    if (input.longitude !== undefined) {
      patch.longitude = pgNumeric<9, 6>(input.longitude, 6);
    }
    await orm(this.db())
      .Address.where({ id: addressId, customerId })
      .update(patch);
    return this.findOwnedAddress(customerId, addressId);
  }

  async deleteAddress(customerId: string, addressId: string): Promise<boolean> {
    const existing = await this.findOwnedAddress(customerId, addressId);
    if (!existing) {
      return false;
    }
    await orm(this.db()).Address.where({ id: addressId, customerId }).delete();
    return true;
  }

  async setDefaultAddress(
    customerId: string,
    addressId: string,
  ): Promise<AddressRecord | null> {
    try {
      return await withUniqueRetry(async () => {
        const db = this.db();
        return db.transaction(async (tx) => {
          const owned = await orm(tx)
            .Address.where({ id: addressId, customerId })
            .first();
          if (!owned) {
            return null;
          }
          await this.clearDefault(tx, customerId);
          await orm(tx)
            .Address.where({ id: addressId, customerId })
            .update({ isDefault: true, updatedAt: pgNow() });
          const row = await orm(tx)
            .Address.where({ id: addressId, customerId })
            .first();
          return row ? this.toAddress(row) : null;
        });
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw customerDefaultAddressInvalid();
      }
      throw error;
    }
  }

  private async clearDefault(
    client: { orm: SpeedyGoDb['orm'] },
    customerId: string,
  ): Promise<void> {
    await orm(client)
      .Address.where({ customerId, isDefault: true })
      .update({ isDefault: false, updatedAt: pgNow() });
  }

  private addressCreatePayload(
    customerId: string,
    input: CreateAddressInput,
    isFirst: boolean,
  ) {
    const now = pgNow();
    return {
      id: createUuidV7(),
      customerId,
      label: pgVarchar<64>(input.label),
      addressText: input.addressText,
      latitude: pgNumeric<9, 6>(input.latitude, 6),
      longitude: pgNumeric<9, 6>(input.longitude, 6),
      isDefault: isFirst,
      createdAt: now,
      updatedAt: now,
    };
  }

  private toProfile(row: {
    id: string;
    accountId: string;
    fullName: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
  }): CustomerProfileRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toAddress(row: {
    id: string;
    customerId: string;
    label: string;
    addressText: string;
    latitude: unknown;
    longitude: unknown;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  }): AddressRecord {
    return {
      id: row.id,
      customerId: row.customerId,
      label: row.label,
      addressText: row.addressText,
      latitude: parseCoordinate(row.latitude),
      longitude: parseCoordinate(row.longitude),
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
