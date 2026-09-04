import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  notificationConfigurationInvalid,
  notificationIntegrityConflict,
  notificationNotFound,
} from '../domain/notification.errors';
import {
  NOTIFICATION_ADVISORY_LOCK_CLASS,
  notificationAdvisoryObjectId,
} from '../domain/notification.policy';
import type {
  DeviceTokenRecord,
  NotificationDeliveryLogRecord,
  NotificationRecord,
  NotificationTypeV1,
} from '../domain/notification.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

async function consumeQueryRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeQueryRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) {
      rows.push(row);
    }
    return rows;
  }
  throw notificationConfigurationInvalid(
    'Notification database query returned an unexpected result',
  );
}

function toNotification(row: {
  id: string;
  accountId: string;
  templateId: string | null;
  title: string;
  body: string;
  category: string;
  read: boolean;
  createdAt: string;
}): NotificationRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    templateId: row.templateId,
    title: row.title,
    body: row.body,
    category: row.category,
    read: row.read,
    createdAt: row.createdAt,
  };
}

function toDelivery(row: {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  providerReference: string | null;
  sentAt: string | null;
  createdAt: string;
}): NotificationDeliveryLogRecord {
  return {
    id: row.id,
    notificationId: row.notificationId,
    channel: row.channel,
    status: row.status,
    providerReference: row.providerReference,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

function toDeviceToken(row: {
  id: string;
  accountId: string;
  deviceId: string | null;
  token: string;
  platform: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}): DeviceTokenRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    deviceId: row.deviceId,
    token: row.token,
    platform: row.platform,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  asClient(client?: OrmClient): OrmClient {
    return client ?? this.db();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  async lockLogicalNotification(
    type: NotificationTypeV1,
    sourceId: string,
    accountId: string,
    client: OrmClient,
  ): Promise<void> {
    if (typeof client.query !== 'function') {
      return;
    }
    const objectId = notificationAdvisoryObjectId(type, sourceId, accountId);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${NOTIFICATION_ADVISORY_LOCK_CLASS}, ${objectId}) IS NULL
              THEN 1
            ELSE 1
          END
        ) = 1
      `
      .returnsRow({
        locked: 'pg/int4@1',
      })
      .build();
    await consumeQueryRows(client.query(plan));
  }

  async findByAccountCategory(
    accountId: string,
    category: string,
    client?: OrmClient,
  ): Promise<NotificationRecord[]> {
    const rows = await orm(this.asClient(client))
      .Notification.where({
        accountId,
        category: pgVarchar<64>(category),
      })
      .all();
    return rows.map(toNotification);
  }

  async createNotification(
    input: {
      accountId: string;
      title: string;
      body: string;
      category: string;
    },
    client: OrmClient,
  ): Promise<NotificationRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).Notification.create({
      id,
      accountId: input.accountId,
      templateId: null,
      title: input.title,
      body: input.body,
      category: pgVarchar<64>(input.category),
      read: false,
      createdAt: now,
    });
    const row = await orm(client).Notification.where({ id }).first();
    if (!row) {
      throw notificationConfigurationInvalid('Notification create failed');
    }
    return toNotification(row);
  }

  async createDeliveryLog(
    input: {
      notificationId: string;
      channel: string;
      status: string;
      providerReference?: string | null;
      sentAt?: Date | null;
    },
    client: OrmClient,
  ): Promise<NotificationDeliveryLogRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).NotificationDeliveryLog.create({
      id,
      notificationId: input.notificationId,
      channel: pgVarchar<32>(input.channel),
      status: pgVarchar<64>(input.status),
      providerReference:
        input.providerReference === undefined ||
        input.providerReference === null
          ? null
          : pgVarchar<255>(input.providerReference),
      sentAt:
        input.sentAt === undefined || input.sentAt === null
          ? null
          : pgTimestamptz(input.sentAt.toISOString()),
      createdAt: now,
    });
    const row = await orm(client).NotificationDeliveryLog.where({ id }).first();
    if (!row) {
      throw notificationConfigurationInvalid('Delivery log create failed');
    }
    return toDelivery(row);
  }

  async listForAccount(
    accountId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: NotificationRecord[]; total: number }> {
    const all = await orm(this.db()).Notification.where({ accountId }).all();
    const sorted = [...all].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    const total = sorted.length;
    const items = sorted
      .slice(page.offset, page.offset + page.limit)
      .map(toNotification);
    return { items, total };
  }

  async countUnread(accountId: string): Promise<number> {
    const rows = await orm(this.db())
      .Notification.where({ accountId, read: false })
      .all();
    return rows.length;
  }

  async findOwned(
    accountId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null> {
    const row = await orm(this.db())
      .Notification.where({ id: notificationId, accountId })
      .first();
    return row ? toNotification(row) : null;
  }

  async markRead(
    accountId: string,
    notificationId: string,
  ): Promise<NotificationRecord> {
    const existing = await this.findOwned(accountId, notificationId);
    if (!existing) {
      throw notificationNotFound();
    }
    if (existing.read) {
      return existing;
    }
    await orm(this.db())
      .Notification.where({ id: notificationId, accountId })
      .update({ read: true });
    const row = await this.findOwned(accountId, notificationId);
    if (!row) {
      throw notificationConfigurationInvalid('Notification mark-read failed');
    }
    return row;
  }

  async markAllRead(accountId: string): Promise<number> {
    const unread = await orm(this.db())
      .Notification.where({ accountId, read: false })
      .all();
    for (const row of unread) {
      await orm(this.db())
        .Notification.where({ id: row.id })
        .update({ read: true });
    }
    return unread.length;
  }

  async findActiveDeviceTokens(
    accountId: string,
  ): Promise<DeviceTokenRecord[]> {
    const rows = await orm(this.db())
      .DeviceToken.where({ accountId, active: true })
      .all();
    return rows.map(toDeviceToken);
  }

  async upsertDeviceToken(input: {
    accountId: string;
    deviceId: string | null;
    token: string;
    platform: string;
  }): Promise<DeviceTokenRecord> {
    return this.runInTransaction(async (tx) => {
      const byToken = await orm(tx)
        .DeviceToken.where({ token: input.token })
        .first();
      const now = pgNow();
      if (byToken) {
        if (byToken.accountId !== input.accountId) {
          throw notificationIntegrityConflict(
            'Push token is registered to another account',
          );
        }
        await orm(tx)
          .DeviceToken.where({ id: byToken.id })
          .update({
            deviceId: input.deviceId,
            platform: pgVarchar<32>(input.platform),
            active: true,
            updatedAt: now,
          });
        const row = await orm(tx).DeviceToken.where({ id: byToken.id }).first();
        if (!row) {
          throw notificationConfigurationInvalid('DeviceToken update failed');
        }
        return toDeviceToken(row);
      }
      if (input.deviceId) {
        for (const existing of await orm(tx)
          .DeviceToken.where({ deviceId: input.deviceId, active: true })
          .all()) {
          await orm(tx)
            .DeviceToken.where({ id: existing.id })
            .update({ active: false, updatedAt: now });
        }
      }
      const id = createUuidV7();
      await orm(tx).DeviceToken.create({
        id,
        accountId: input.accountId,
        deviceId: input.deviceId,
        token: input.token,
        platform: pgVarchar<32>(input.platform),
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await orm(tx).DeviceToken.where({ id }).first();
      if (!row) {
        throw notificationConfigurationInvalid('DeviceToken create failed');
      }
      return toDeviceToken(row);
    });
  }

  async deactivateDeviceToken(accountId: string, token: string): Promise<void> {
    const row = await orm(this.db())
      .DeviceToken.where({ accountId, token })
      .first();
    if (!row) {
      return;
    }
    await orm(this.db())
      .DeviceToken.where({ id: row.id })
      .update({ active: false, updatedAt: pgNow() });
  }

  /**
   * Merchant members with ORDER_READ (OWNER/MANAGER/STAFF) for operational notices.
   */
  async listMerchantOrderRecipientAccountIds(
    merchantId: string,
  ): Promise<string[]> {
    const members = await orm(this.db())
      .MerchantMember.where({ merchantId })
      .all();
    const accounts = new Set<string>();
    for (const member of members) {
      if (
        member.role === 'OWNER' ||
        member.role === 'MANAGER' ||
        member.role === 'STAFF'
      ) {
        accounts.add(member.accountId);
      }
    }
    return [...accounts].sort();
  }

  /**
   * Merchant members with SETTLEMENT_READ (OWNER/MANAGER only).
   */
  async listMerchantSettlementRecipientAccountIds(
    merchantId: string,
  ): Promise<string[]> {
    const members = await orm(this.db())
      .MerchantMember.where({ merchantId })
      .all();
    const accounts = new Set<string>();
    for (const member of members) {
      if (member.role === 'OWNER' || member.role === 'MANAGER') {
        accounts.add(member.accountId);
      }
    }
    return [...accounts].sort();
  }

  async findCustomerAccountIdByCustomerId(
    customerId: string,
  ): Promise<string | null> {
    const profile = await orm(this.db())
      .CustomerProfile.where({ id: customerId })
      .first();
    return profile?.accountId ?? null;
  }

  async findDriverAccountIdByDriverId(
    driverId: string,
  ): Promise<string | null> {
    const profile = await orm(this.db())
      .DriverProfile.where({ id: driverId })
      .first();
    return profile?.accountId ?? null;
  }

  async findOrderNotifyContext(orderId: string): Promise<{
    orderId: string;
    customerId: string;
    publicReference: string;
    merchantId: string | null;
  } | null> {
    const order = await orm(this.db()).Order.where({ id: orderId }).first();
    if (!order) return null;
    const branch = await orm(this.db())
      .MerchantBranch.where({ id: order.merchantBranchId })
      .first();
    return {
      orderId: order.id,
      customerId: order.customerId,
      publicReference: order.publicReference,
      merchantId: branch?.merchantId ?? null,
    };
  }

  async findPaymentNotifyContext(paymentId: string): Promise<{
    paymentId: string;
    orderId: string;
    customerId: string;
    publicReference: string;
    status: string;
  } | null> {
    const payment = await orm(this.db())
      .Payment.where({ id: paymentId })
      .first();
    if (!payment) return null;
    const order = await this.findOrderNotifyContext(payment.orderId);
    if (!order) return null;
    return {
      paymentId: payment.id,
      orderId: order.orderId,
      customerId: order.customerId,
      publicReference: order.publicReference,
      status: payment.status,
    };
  }

  async findRefundNotifyContext(refundId: string): Promise<{
    refundId: string;
    orderId: string;
    customerId: string;
    publicReference: string;
    status: string;
  } | null> {
    const refund = await orm(this.db()).Refund.where({ id: refundId }).first();
    if (!refund) return null;
    const order = await this.findOrderNotifyContext(refund.orderId);
    if (!order) return null;
    return {
      refundId: refund.id,
      orderId: order.orderId,
      customerId: order.customerId,
      publicReference: order.publicReference,
      status: refund.status,
    };
  }
}
