import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../infrastructure/database/pg-values';
import { createUuidV7 } from '../../common/utils/uuid-v7';
import type { AuthChannel, DeviceMetadata } from '../auth/domain/auth.types';

export type AccountRow = {
  id: string;
  phone: string | null;
  email: string | null;
  status: string;
};

export type SessionRow = {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  deviceId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type DeviceRow = {
  id: string;
  accountId: string;
  platform: string;
  deviceName: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

function deviceFields(metadata: DeviceMetadata, existingName?: string | null) {
  return {
    platform: pgVarchar<32>(metadata.platform),
    appVersion: pgVarchar<32>(metadata.appVersion),
    deviceName: metadata.deviceName
      ? pgVarchar<128>(metadata.deviceName)
      : existingName
        ? pgVarchar<128>(existingName)
        : null,
    lastSeenAt: pgNow(),
  };
}

@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByIdentifier(
    channel: AuthChannel,
    identifier: string,
  ): Promise<AccountRow | null> {
    const accounts = orm(this.db()).Account;
    const row =
      channel === 'PHONE'
        ? await accounts.where({ phone: pgVarchar<32>(identifier) }).first()
        : await accounts.where({ email: pgVarchar<255>(identifier) }).first();
    return row ? this.toAccount(row) : null;
  }

  async findById(id: string): Promise<AccountRow | null> {
    const row = await orm(this.db()).Account.where({ id }).first();
    return row ? this.toAccount(row) : null;
  }

  async createMinimal(
    channel: AuthChannel,
    identifier: string,
  ): Promise<AccountRow> {
    const now = pgNow();
    const row = await orm(this.db()).Account.create({
      id: createUuidV7(),
      phone: channel === 'PHONE' ? pgVarchar<32>(identifier) : null,
      email: channel === 'EMAIL' ? pgVarchar<255>(identifier) : null,
      status: pgVarchar<64>('ACTIVE'),
      createdAt: now,
      updatedAt: now,
    });
    return this.toAccount(row);
  }

  async upsertDevice(
    accountId: string,
    metadata: DeviceMetadata,
  ): Promise<string> {
    const devices = orm(this.db()).Device;
    const requestedId = metadata.deviceId;
    if (requestedId && UUID_RE.test(requestedId)) {
      const existing = await devices.where({ id: requestedId }).first();
      if (existing && existing.accountId === accountId) {
        await devices
          .where({ id: requestedId })
          .update(deviceFields(metadata, existing.deviceName));
        return requestedId;
      }
      if (!existing) {
        await devices.create({
          id: requestedId,
          accountId,
          ...deviceFields(metadata),
          createdAt: pgNow(),
        });
        return requestedId;
      }
    }
    const created = await devices.create({
      id: createUuidV7(),
      accountId,
      ...deviceFields(metadata),
      createdAt: pgNow(),
    });
    return created.id;
  }

  async createAuthenticatedSession(input: {
    sessionId: string;
    accountId: string;
    device: DeviceMetadata;
    refreshTokenHash: string;
    ipAddress: string | null;
    expiresAt: string;
  }): Promise<{ sessionId: string; deviceId: string }> {
    const db = this.db();
    return db.transaction(async (tx) => {
      const devices = orm(tx).Device;
      const requestedId = input.device.deviceId;
      let deviceId: string;
      if (requestedId && UUID_RE.test(requestedId)) {
        const existing = await devices.where({ id: requestedId }).first();
        if (existing && existing.accountId === input.accountId) {
          await devices
            .where({ id: requestedId })
            .update(deviceFields(input.device, existing.deviceName));
          deviceId = requestedId;
        } else if (!existing) {
          await devices.create({
            id: requestedId,
            accountId: input.accountId,
            ...deviceFields(input.device),
            createdAt: pgNow(),
          });
          deviceId = requestedId;
        } else {
          const created = await devices.create({
            id: createUuidV7(),
            accountId: input.accountId,
            ...deviceFields(input.device),
            createdAt: pgNow(),
          });
          deviceId = created.id;
        }
      } else {
        const created = await devices.create({
          id: createUuidV7(),
          accountId: input.accountId,
          ...deviceFields(input.device),
          createdAt: pgNow(),
        });
        deviceId = created.id;
      }

      await orm(tx).Session.create({
        id: input.sessionId,
        accountId: input.accountId,
        refreshTokenHash: pgVarchar<255>(input.refreshTokenHash),
        deviceId,
        ipAddress: input.ipAddress,
        expiresAt: pgTimestamptz(input.expiresAt),
        revokedAt: null,
        createdAt: pgNow(),
      });
      return { sessionId: input.sessionId, deviceId };
    });
  }

  async createSession(input: {
    accountId: string;
    deviceId: string;
    refreshTokenHash: string;
    ipAddress: string | null;
    expiresAt: string;
  }): Promise<SessionRow> {
    const row = await orm(this.db()).Session.create({
      id: createUuidV7(),
      accountId: input.accountId,
      refreshTokenHash: pgVarchar<255>(input.refreshTokenHash),
      deviceId: input.deviceId,
      ipAddress: input.ipAddress,
      expiresAt: pgTimestamptz(input.expiresAt),
      revokedAt: null,
      createdAt: pgNow(),
    });
    return this.toSession(row);
  }

  async findSession(id: string): Promise<SessionRow | null> {
    const row = await orm(this.db()).Session.where({ id }).first();
    return row ? this.toSession(row) : null;
  }

  async rotateRefreshHash(input: {
    sessionId: string;
    expectedHash: string;
    nextHash: string;
  }): Promise<boolean> {
    const count = await orm(this.db())
      .Session.where({
        id: input.sessionId,
        refreshTokenHash: pgVarchar<255>(input.expectedHash),
      })
      .where((session) => session.revokedAt.isNull())
      .updateAndCount({
        refreshTokenHash: pgVarchar<255>(input.nextHash),
      });
    return count === 1;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await orm(this.db())
      .Session.where({ id: sessionId })
      .where((session) => session.revokedAt.isNull())
      .update({ revokedAt: pgNow() });
  }

  async revokeAllSessions(accountId: string): Promise<string[]> {
    const sessions = orm(this.db()).Session;
    const active = await sessions
      .where({ accountId })
      .where((session) => session.revokedAt.isNull())
      .select('id')
      .all();
    const ids = active.map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }
    await sessions
      .where({ accountId })
      .where((session) => session.revokedAt.isNull())
      .update({ revokedAt: pgNow() });
    return ids;
  }

  async listSessions(accountId: string): Promise<SessionRow[]> {
    const rows = await orm(this.db())
      .Session.where({ accountId })
      .orderBy((session) => session.createdAt.desc())
      .all();
    return rows.map((row) => this.toSession(row));
  }

  async findDevice(id: string): Promise<DeviceRow | null> {
    const row = await orm(this.db()).Device.where({ id }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      accountId: row.accountId,
      platform: row.platform,
      deviceName: row.deviceName,
    };
  }

  async profileFlags(accountId: string) {
    const db = orm(this.db());
    const [customer, driver, admin, membership] = await Promise.all([
      db.CustomerProfile.where({ accountId }).first(),
      db.DriverProfile.where({ accountId }).first(),
      db.AdminProfile.where({ accountId }).first(),
      db.MerchantMember.where({ accountId }).first(),
    ]);
    return {
      hasCustomerProfile: Boolean(customer),
      hasDriverProfile: Boolean(driver),
      hasAdminProfile: Boolean(admin),
      hasMerchantMembership: Boolean(membership),
    };
  }

  private toAccount(row: {
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  }): AccountRow {
    return {
      id: row.id,
      phone: row.phone,
      email: row.email,
      status: row.status,
    };
  }

  private toSession(row: {
    id: string;
    accountId: string;
    refreshTokenHash: string;
    deviceId: string | null;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }): SessionRow {
    return {
      id: row.id,
      accountId: row.accountId,
      refreshTokenHash: row.refreshTokenHash,
      deviceId: row.deviceId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }
}
