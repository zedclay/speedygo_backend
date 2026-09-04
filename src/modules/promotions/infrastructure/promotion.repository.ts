import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { promotionConfigurationInvalid } from '../domain/promotion.errors';
import {
  PROMOTION_ADVISORY_LOCK_CLASS,
  promotionAdvisoryObjectId,
} from '../domain/promotion.lock';
import type {
  PromotionFundingV1,
  PromotionRecord,
  PromotionRedemptionRecord,
} from '../domain/promotion.types';

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
  throw promotionConfigurationInvalid(
    'Promotion database query returned an unexpected result',
  );
}

function toPromotion(row: {
  id: string;
  code: string;
  type: string;
  value: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}): PromotionRecord {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRedemption(row: {
  id: string;
  promotionId: string;
  customerId: string;
  orderId: string;
  discountAmountMinor: unknown;
  fundedBy: string;
  redeemedAt: string;
}): PromotionRedemptionRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    customerId: row.customerId,
    orderId: row.orderId,
    discountAmountMinor: Number(row.discountAmountMinor),
    fundedBy: row.fundedBy as PromotionFundingV1,
    redeemedAt: row.redeemedAt,
  };
}

@Injectable()
export class PromotionRepository {
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

  async lockPromotion(promotionId: string, client: OrmClient): Promise<void> {
    if (typeof client.query !== 'function') {
      return;
    }
    const objectId = promotionAdvisoryObjectId(promotionId);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${PROMOTION_ADVISORY_LOCK_CLASS}, ${objectId}) IS NULL
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

  async findByNormalizedCode(
    code: string,
    client?: OrmClient,
  ): Promise<PromotionRecord | null> {
    const row = await orm(this.asClient(client))
      .Promotion.where({ code: pgVarchar<64>(code) })
      .first();
    return row ? toPromotion(row) : null;
  }

  async findById(
    id: string,
    client?: OrmClient,
  ): Promise<PromotionRecord | null> {
    const row = await orm(this.asClient(client))
      .Promotion.where({ id })
      .first();
    return row ? toPromotion(row) : null;
  }

  async createPromotion(input: {
    code: string;
    type: string;
    value: number;
    startsAt: string;
    endsAt: string;
    active: boolean;
  }): Promise<PromotionRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(this.db()).Promotion.create({
      id,
      code: pgVarchar<64>(input.code),
      type: pgVarchar<64>(input.type),
      value: input.value,
      startsAt: pgTimestamptz(input.startsAt),
      endsAt: pgTimestamptz(input.endsAt),
      active: input.active,
      createdAt: now,
      updatedAt: now,
    });
    const row = await orm(this.db()).Promotion.where({ id }).first();
    if (!row) {
      throw promotionConfigurationInvalid('Promotion create failed');
    }
    return toPromotion(row);
  }

  async setActive(id: string, active: boolean): Promise<PromotionRecord> {
    await orm(this.db())
      .Promotion.where({ id })
      .update({ active, updatedAt: pgNow() });
    const row = await orm(this.db()).Promotion.where({ id }).first();
    if (!row) {
      throw promotionConfigurationInvalid('Promotion update failed');
    }
    return toPromotion(row);
  }

  async countRedemptionsForOrder(
    orderId: string,
    client?: OrmClient,
  ): Promise<number> {
    const rows = await orm(this.asClient(client))
      .PromotionRedemption.where({ orderId })
      .all();
    return rows.length;
  }

  async createRedemption(
    input: {
      promotionId: string;
      customerId: string;
      orderId: string;
      discountAmountMinor: number;
      fundedBy: PromotionFundingV1;
      redeemedAt: Date;
    },
    client: OrmClient,
  ): Promise<PromotionRedemptionRecord> {
    const id = createUuidV7();
    await orm(client).PromotionRedemption.create({
      id,
      promotionId: input.promotionId,
      customerId: input.customerId,
      orderId: input.orderId,
      discountAmountMinor: pgBigInt(input.discountAmountMinor),
      fundedBy: input.fundedBy,
      redeemedAt: pgTimestamptz(input.redeemedAt.toISOString()),
    });
    const row = await orm(client).PromotionRedemption.where({ id }).first();
    if (!row) {
      throw promotionConfigurationInvalid('Promotion redemption create failed');
    }
    return toRedemption(row);
  }

  async listRedemptionsForOrder(
    orderId: string,
    client?: OrmClient,
  ): Promise<PromotionRedemptionRecord[]> {
    const rows = await orm(this.asClient(client))
      .PromotionRedemption.where({ orderId })
      .all();
    return rows.map(toRedemption);
  }
}
