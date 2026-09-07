import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgTime,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  DELIVERY_PRICING_ZONE_LOCK_CLASS,
  deliveryPricingZoneAdvisoryObjectId,
} from '../domain/delivery-pricing.lock';
import {
  deliveryPricingRuleIntegrity,
  deliveryPricingRuleNotFound,
} from '../domain/delivery-pricing.errors';
import type {
  CreateDeliveryPricingRuleInput,
  DeliveryPricingRuleRecord,
} from '../domain/delivery-pricing.types';

/**
 * Minimal ORM client — matches the transaction context shape (OrmClient pattern).
 * Methods that need FOR UPDATE use `this.db().raw.sql` to build plans, then
 * execute via `client.query!(plan)` within the transaction.
 */
export type RuleOrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: RuleOrmClient) {
  return client.orm.public;
}

/** Drain a result that may be an array, Promise, or AsyncIterable. */
async function consumeRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) return result as T[];
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) rows.push(row);
    return rows;
  }
  return [];
}

function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return String(v);
  return String(v);
}

function toNullableStr(v: unknown): string | null {
  if (v == null) return null;
  return toStr(v);
}

function toRuleRecord(row: {
  id: unknown;
  zoneId: unknown;
  name: unknown;
  timeBand: unknown;
  startLocalTime: unknown;
  endLocalTime: unknown;
  customerDeliveryFeeMinor: unknown;
  driverRemunerationMinor: unknown;
  effectiveFrom: unknown;
  effectiveTo: unknown;
  active: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}): DeliveryPricingRuleRecord {
  const activeStr = toStr(row.active);
  return {
    id: toStr(row.id),
    zoneId: toStr(row.zoneId),
    name: toStr(row.name),
    timeBand: toStr(row.timeBand) as DeliveryPricingRuleRecord['timeBand'],
    startLocalTime: toNullableStr(row.startLocalTime),
    endLocalTime: toNullableStr(row.endLocalTime),
    customerDeliveryFeeMinor: BigInt(
      row.customerDeliveryFeeMinor as string | number,
    ),
    driverRemunerationMinor: BigInt(
      row.driverRemunerationMinor as string | number,
    ),
    effectiveFrom: toStr(row.effectiveFrom),
    effectiveTo: toNullableStr(row.effectiveTo),
    active: activeStr === 'true' || activeStr === 't',
    createdAt: toStr(row.createdAt),
    updatedAt: toStr(row.updatedAt),
  };
}

export type AdminPricingRuleListQuery = {
  limit: number;
  offset: number;
  zoneId?: string;
  active?: boolean;
  sortBy?: 'effectiveFrom' | 'createdAt';
  sortDir?: 'ASC' | 'DESC';
};

@Injectable()
export class DeliveryPricingRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findById(
    id: string,
    client?: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord | null> {
    const row = await orm(client ?? this.db())
      .DeliveryPricingRule.where({ id })
      .first();
    if (!row) return null;
    return toRuleRecord(row);
  }

  /**
   * Find by id with FOR UPDATE lock — must be called inside a transaction.
   * Builds the plan from `this.db().raw.sql` (template tag requires full client),
   * then executes via `client.query!(plan)` so it runs in the correct transaction.
   */
  async findByIdForUpdate(
    id: string,
    client: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord | null> {
    if (typeof client.query !== 'function') {
      // Fallback for test mocks that don't provide query
      return this.findById(id, client);
    }
    const plan = this.db().raw.sql`
      SELECT id, zone_id AS "zoneId", name, time_band AS "timeBand",
             start_local_time AS "startLocalTime", end_local_time AS "endLocalTime",
             customer_delivery_fee_minor AS "customerDeliveryFeeMinor",
             driver_remuneration_minor AS "driverRemunerationMinor",
             effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
             active::text AS active,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM delivery_pricing_rules
      WHERE id = ${id}
      FOR UPDATE
    `
      .returnsRow({
        id: 'pg/uuid@1' as const,
        zoneId: 'pg/uuid@1' as const,
        name: 'sql/varchar@1' as const,
        timeBand: 'sql/varchar@1' as const,
        startLocalTime: { codecId: 'sql/varchar@1' as const, nullable: true },
        endLocalTime: { codecId: 'sql/varchar@1' as const, nullable: true },
        customerDeliveryFeeMinor: 'pg/int8@1' as const,
        driverRemunerationMinor: 'pg/int8@1' as const,
        effectiveFrom: 'pg/timestamptz-string@1' as const,
        effectiveTo: {
          codecId: 'pg/timestamptz-string@1' as const,
          nullable: true,
        },
        active: 'sql/varchar@1' as const,
        createdAt: 'pg/timestamptz-string@1' as const,
        updatedAt: 'pg/timestamptz-string@1' as const,
      })
      .build();
    const rows = await consumeRows<{
      id: unknown;
      zoneId: unknown;
      name: unknown;
      timeBand: unknown;
      startLocalTime: unknown;
      endLocalTime: unknown;
      customerDeliveryFeeMinor: unknown;
      driverRemunerationMinor: unknown;
      effectiveFrom: unknown;
      effectiveTo: unknown;
      active: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    }>(client.query(plan));
    const first = rows[0];
    if (!first) return null;
    return toRuleRecord(first);
  }

  /** Lock all active rules for a zone with FOR UPDATE to prevent concurrent activation races. */
  async lockActiveRulesForZone(
    zoneId: string,
    client: RuleOrmClient,
  ): Promise<void> {
    if (typeof client.query !== 'function') return;
    const plan = this.db().raw.sql`
      SELECT id FROM delivery_pricing_rules
      WHERE zone_id = ${zoneId} AND active = true
      FOR UPDATE
    `
      .returnsRow({ id: 'pg/uuid@1' as const })
      .build();
    await consumeRows(client.query(plan));
  }

  /**
   * Transaction-scoped per-Zone advisory lock for any mutation that can change
   * active-rule authority for the Zone.
   */
  async lockPricingAuthorityForZone(
    zoneId: string,
    client: RuleOrmClient,
  ): Promise<void> {
    if (typeof client.query !== 'function') return;
    const objectId = deliveryPricingZoneAdvisoryObjectId(zoneId);
    const plan = this.db().raw.sql`
      SELECT 1::int4 AS locked
      WHERE (
        SELECT CASE
          WHEN pg_advisory_xact_lock(
            ${DELIVERY_PRICING_ZONE_LOCK_CLASS},
            ${objectId}
          ) IS NULL THEN 1
          ELSE 1
        END
      ) = 1
    `
      .returnsRow({ locked: 'pg/int4@1' as const })
      .build();
    await consumeRows(client.query(plan));
  }

  async listActiveRulesForZone(
    zoneId: string,
    client?: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord[]> {
    const rows = await orm(client ?? this.db())
      .DeliveryPricingRule.where({ zoneId, active: true })
      .all();
    return rows.map(toRuleRecord);
  }

  async countActiveRulesForZone(
    zoneId: string,
    client?: RuleOrmClient,
  ): Promise<number> {
    const rows = await this.listActiveRulesForZone(zoneId, client);
    return rows.length;
  }

  async list(query: AdminPricingRuleListQuery): Promise<{
    items: DeliveryPricingRuleRecord[];
    total: number;
  }> {
    const db = this.db();
    const where: Record<string, unknown> = {};
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.active !== undefined) where.active = query.active;

    const counted = await orm(db)
      .DeliveryPricingRule.where(where)
      .aggregate((agg) => ({ total: agg.count() }));

    let rows: any[];
    if (query.sortBy === 'effectiveFrom') {
      if (query.sortDir === 'ASC') {
        rows = await orm(db)
          .DeliveryPricingRule.where(where)
          .orderBy((row) => row.effectiveFrom.asc())
          .offset(query.offset)
          .limit(query.limit)
          .all();
      } else {
        rows = await orm(db)
          .DeliveryPricingRule.where(where)
          .orderBy((row) => row.effectiveFrom.desc())
          .offset(query.offset)
          .limit(query.limit)
          .all();
      }
    } else {
      if (query.sortDir === 'ASC') {
        rows = await orm(db)
          .DeliveryPricingRule.where(where)
          .orderBy((row) => row.createdAt.asc())
          .offset(query.offset)
          .limit(query.limit)
          .all();
      } else {
        rows = await orm(db)
          .DeliveryPricingRule.where(where)
          .orderBy((row) => row.createdAt.desc())
          .offset(query.offset)
          .limit(query.limit)
          .all();
      }
    }

    return {
      items: rows.map(toRuleRecord),
      total: Number(counted.total),
    };
  }

  async create(
    input: CreateDeliveryPricingRuleInput,
    client?: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client ?? this.db()).DeliveryPricingRule.create({
      id,
      zoneId: input.zoneId,
      name: pgVarchar<255>(input.name),
      timeBand: input.timeBand,
      startLocalTime: input.startLocalTime
        ? pgTime(input.startLocalTime)
        : null,
      endLocalTime: input.endLocalTime ? pgTime(input.endLocalTime) : null,
      customerDeliveryFeeMinor: pgBigInt(input.customerDeliveryFeeMinor),
      driverRemunerationMinor: pgBigInt(input.driverRemunerationMinor),
      effectiveFrom: pgTimestamptz(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? pgTimestamptz(input.effectiveTo) : null,
      active: false,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(id, client);
    if (!created) {
      throw deliveryPricingRuleIntegrity('DeliveryPricingRule create failed');
    }
    return created;
  }

  async setActive(
    id: string,
    active: boolean,
    client?: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord> {
    await orm(client ?? this.db())
      .DeliveryPricingRule.where({ id })
      .update({
        active,
        updatedAt: pgNow(),
      });
    const updated = await this.findById(id, client);
    if (!updated) {
      throw deliveryPricingRuleIntegrity(
        'DeliveryPricingRule setActive failed',
      );
    }
    return updated;
  }

  async requireById(
    id: string,
    client?: RuleOrmClient,
  ): Promise<DeliveryPricingRuleRecord> {
    const rule = await this.findById(id, client);
    if (!rule) throw deliveryPricingRuleNotFound();
    return rule;
  }
}
