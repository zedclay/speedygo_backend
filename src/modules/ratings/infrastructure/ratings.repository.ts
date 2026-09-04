import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow } from '../../../infrastructure/database/pg-values';
import { isHistoricalServingAssignment } from '../domain/ratings.policy';
import { ratingIntegrity } from '../domain/ratings.errors';
import type {
  DriverRatingRecord,
  EligibleOrderContext,
  MerchantRatingRecord,
} from '../domain/ratings.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

function toDriverRating(row: {
  id: string;
  orderId: string;
  customerId: string;
  driverId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}): DriverRatingRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    customerId: row.customerId,
    driverId: row.driverId,
    score: Number(row.score),
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

function toMerchantRating(row: {
  id: string;
  orderId: string;
  customerId: string;
  merchantId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}): MerchantRatingRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    customerId: row.customerId,
    merchantId: row.merchantId,
    score: Number(row.score),
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class RatingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx) => fn(tx));
  }

  async findCustomerProfileByAccountId(
    accountId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async findDriverProfileByAccountId(
    accountId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(this.db()).DriverProfile.where({ accountId }).first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async isMerchantMember(
    merchantId: string,
    accountId: string,
  ): Promise<boolean> {
    const row = await orm(this.db())
      .MerchantMember.where({ merchantId, accountId })
      .first();
    return Boolean(row);
  }

  async lockEligibleOrderContext(
    orderId: string,
    client: OrmClient,
  ): Promise<EligibleOrderContext | null> {
    await orm(client)
      .Order.where({ id: orderId })
      .update({ updatedAt: pgNow() });
    return this.loadOrderContext(orderId, client);
  }

  async findOrderOwnership(
    orderId: string,
  ): Promise<EligibleOrderContext | null> {
    return this.loadOrderContext(orderId, this.db());
  }

  private async loadOrderContext(
    orderId: string,
    client: OrmClient,
  ): Promise<EligibleOrderContext | null> {
    const order = await orm(client).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    const branch = await orm(client)
      .MerchantBranch.where({ id: order.merchantBranchId })
      .first();
    if (!branch) {
      throw ratingIntegrity(`Order ${orderId} merchant branch is missing`);
    }
    return {
      orderId: order.id,
      customerId: order.customerId,
      status: String(order.status),
      merchantId: branch.merchantId,
      merchantBranchId: branch.id,
    };
  }

  /**
   * Derive the Driver who actually served a DELIVERED Delivery.
   * Prefer RELEASED+acceptedAt (post-completion). Never REJECTED/EXPIRED/OFFERED.
   * Ambiguous serving rows → integrity; absent → null.
   */
  async findDeliveredDriverId(
    orderId: string,
    client: OrmClient,
  ): Promise<{ deliveryId: string; driverId: string } | null> {
    const delivery = await orm(client).Delivery.where({ orderId }).first();
    if (!delivery || String(delivery.status) !== 'DELIVERED') {
      return null;
    }
    const assignments = await orm(client)
      .DriverAssignment.where({ deliveryId: delivery.id })
      .all();
    const serving = assignments.filter((a) =>
      isHistoricalServingAssignment({
        status: String(a.status),
        acceptedAt: a.acceptedAt,
        releasedAt: a.releasedAt,
      }),
    );
    if (serving.length === 0) {
      return null;
    }
    if (serving.length > 1) {
      throw ratingIntegrity(
        `Delivery ${delivery.id} has ambiguous historical serving DriverAssignment rows`,
      );
    }
    return {
      deliveryId: delivery.id,
      driverId: serving[0].driverId,
    };
  }

  async findDriverRatingByOrderCustomer(
    orderId: string,
    customerId: string,
    client?: OrmClient,
  ): Promise<DriverRatingRecord | null> {
    const db = client ? orm(client) : orm(this.db());
    const rows = await db.DriverRating.where({ orderId, customerId }).all();
    if (rows.length > 1) {
      throw ratingIntegrity(`Duplicate DriverRating rows for order ${orderId}`);
    }
    return rows[0] ? toDriverRating(rows[0]) : null;
  }

  async findMerchantRatingByOrderCustomer(
    orderId: string,
    customerId: string,
    client?: OrmClient,
  ): Promise<MerchantRatingRecord | null> {
    const db = client ? orm(client) : orm(this.db());
    const rows = await db.MerchantRating.where({ orderId, customerId }).all();
    if (rows.length > 1) {
      throw ratingIntegrity(
        `Duplicate MerchantRating rows for order ${orderId}`,
      );
    }
    return rows[0] ? toMerchantRating(rows[0]) : null;
  }

  async createDriverRating(
    input: {
      orderId: string;
      customerId: string;
      driverId: string;
      score: number;
      comment: string | null;
    },
    client: OrmClient,
  ): Promise<DriverRatingRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).DriverRating.create({
      id,
      orderId: input.orderId,
      customerId: input.customerId,
      driverId: input.driverId,
      score: input.score,
      comment: input.comment,
      createdAt: now,
    });
    const row = await orm(client).DriverRating.where({ id }).first();
    if (!row) {
      throw new Error('DriverRating create did not persist');
    }
    return toDriverRating(row);
  }

  async createMerchantRating(
    input: {
      orderId: string;
      customerId: string;
      merchantId: string;
      score: number;
      comment: string | null;
    },
    client: OrmClient,
  ): Promise<MerchantRatingRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).MerchantRating.create({
      id,
      orderId: input.orderId,
      customerId: input.customerId,
      merchantId: input.merchantId,
      score: input.score,
      comment: input.comment,
      createdAt: now,
    });
    const row = await orm(client).MerchantRating.where({ id }).first();
    if (!row) {
      throw new Error('MerchantRating create did not persist');
    }
    return toMerchantRating(row);
  }

  async aggregateDriverRatings(
    driverId: string,
  ): Promise<{ count: number; sum: number }> {
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS rating_count,
          COALESCE(SUM(score), 0)::int4 AS score_sum
        FROM driver_ratings
        WHERE driver_id = ${driverId}::uuid
      `
      .returnsRow({
        rating_count: 'pg/int4@1',
        score_sum: 'pg/int4@1',
      })
      .build();
    const rows: Array<{ rating_count: number; score_sum: number }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    const row = rows[0];
    return {
      count: Number(row?.rating_count ?? 0),
      sum: Number(row?.score_sum ?? 0),
    };
  }

  async aggregateMerchantRatings(
    merchantId: string,
  ): Promise<{ count: number; sum: number }> {
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS rating_count,
          COALESCE(SUM(score), 0)::int4 AS score_sum
        FROM merchant_ratings
        WHERE merchant_id = ${merchantId}::uuid
      `
      .returnsRow({
        rating_count: 'pg/int4@1',
        score_sum: 'pg/int4@1',
      })
      .build();
    const rows: Array<{ rating_count: number; score_sum: number }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    const row = rows[0];
    return {
      count: Number(row?.rating_count ?? 0),
      sum: Number(row?.score_sum ?? 0),
    };
  }

  async merchantExists(merchantId: string): Promise<boolean> {
    const row = await orm(this.db()).Merchant.where({ id: merchantId }).first();
    return Boolean(row);
  }

  async driverExists(driverId: string): Promise<boolean> {
    const row = await orm(this.db())
      .DriverProfile.where({ id: driverId })
      .first();
    return Boolean(row);
  }
}
