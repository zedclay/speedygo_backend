import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import { merchantCommissionConfigurationInvalid } from '../domain/merchant-commission.errors';
import { merchantCommissionAdvisoryLockKeys } from '../domain/merchant-commission.lock';
import {
  COMMISSION_SCOPE_GLOBAL_DEFAULT,
  type CommissionScope,
  type MerchantCommissionRuleRecord,
} from '../domain/merchant-commission.types';

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
  throw merchantCommissionConfigurationInvalid(
    'Merchant commission database query returned an unexpected result',
  );
}

@Injectable()
export class MerchantCommissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => fn(tx));
  }

  /**
   * One authoritative PostgreSQL server timestamp for a commission decision.
   * Must be called once per Order create / rule-management window close.
   */
  async readCommissionDecisionAt(client: OrmClient): Promise<Date> {
    const plan = this.db().raw.sql`
        SELECT clock_timestamp() AS decision_at
      `
      .returnsRow({
        decision_at: 'pg/timestamptz-string@1',
      })
      .build();
    const rows = await this.queryOnClient<{ decision_at: string }>(
      client,
      plan,
    );
    const raw = rows[0]?.decision_at;
    const parsed = raw ? new Date(String(raw)) : new Date(Number.NaN);
    if (!Number.isFinite(parsed.getTime())) {
      throw merchantCommissionConfigurationInvalid(
        'Failed to read commission decision timestamp from the database',
      );
    }
    return parsed;
  }

  /**
   * Transaction-scoped `pg_advisory_xact_lock(classId, objectId)`.
   * Serializes GLOBAL_DEFAULT writes globally and MERCHANT_OVERRIDE writes per Merchant.
   * The lock function returns void; wrap it so the planner cannot skip evaluation
   * (e.g. via `OR TRUE` short-circuit) and project a constant int4 for the row codec.
   */
  async lockConfigurationScope(
    scope: CommissionScope,
    merchantId: string | null,
    client: OrmClient,
  ): Promise<void> {
    const keys = merchantCommissionAdvisoryLockKeys(scope, merchantId);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${keys.classId}, ${keys.objectId}) IS NULL
              THEN 1
            ELSE 1
          END
        ) = 1
      `
      .returnsRow({
        locked: 'pg/int4@1',
      })
      .build();
    await this.queryOnClient(client, plan);
  }

  async listActiveCandidateRules(
    merchantId: string,
    client?: OrmClient,
  ): Promise<MerchantCommissionRuleRecord[]> {
    const db = client ?? { orm: this.db().orm };
    const [overrides, globals] = await Promise.all([
      orm(db)
        .MerchantCommissionRule.where({
          merchantId,
          active: true,
          scope: 'MERCHANT_OVERRIDE',
        })
        .all(),
      orm(db)
        .MerchantCommissionRule.where({
          active: true,
          scope: 'GLOBAL_DEFAULT',
        })
        .all(),
    ]);
    return [...overrides, ...globals].map(toRecord);
  }

  async listActiveRulesByScope(input: {
    scope: string;
    merchantId: string | null;
    client?: OrmClient;
  }): Promise<MerchantCommissionRuleRecord[]> {
    const db = input.client ?? { orm: this.db().orm };
    if (input.scope === COMMISSION_SCOPE_GLOBAL_DEFAULT) {
      const rows = await orm(db)
        .MerchantCommissionRule.where({
          active: true,
          scope: 'GLOBAL_DEFAULT',
        })
        .all();
      return rows.map(toRecord);
    }
    if (!input.merchantId) {
      return [];
    }
    const rows = await orm(db)
      .MerchantCommissionRule.where({
        merchantId: input.merchantId,
        active: true,
        scope: 'MERCHANT_OVERRIDE',
      })
      .all();
    return rows.map(toRecord);
  }

  async findById(
    ruleId: string,
    client?: OrmClient,
  ): Promise<MerchantCommissionRuleRecord | null> {
    const db = client ?? { orm: this.db().orm };
    const row = await orm(db)
      .MerchantCommissionRule.where({ id: ruleId })
      .first();
    return row ? toRecord(row) : null;
  }

  async createRule(
    input: {
      scope: string;
      merchantId: string | null;
      rateBps: number;
      effectiveFrom: string;
      effectiveTo: string | null;
      changeReason: string | null;
      changedByAdminId: string;
    },
    client?: OrmClient,
  ): Promise<MerchantCommissionRuleRecord> {
    const db = client ?? { orm: this.db().orm };
    const id = createUuidV7();
    const createdAt = pgNow();
    await orm(db).MerchantCommissionRule.create({
      id,
      scope: input.scope as 'GLOBAL_DEFAULT' | 'MERCHANT_OVERRIDE',
      merchantId: input.merchantId,
      rateBps: input.rateBps,
      effectiveFrom: pgTimestamptz(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? pgTimestamptz(input.effectiveTo) : null,
      changeReason: input.changeReason,
      changedByAdminId: input.changedByAdminId,
      active: true,
      createdAt,
    });
    const row = await orm(db).MerchantCommissionRule.where({ id }).first();
    if (!row) {
      throw new Error('MerchantCommissionRule create did not persist');
    }
    return toRecord(row);
  }

  async deactivateRule(
    ruleId: string,
    effectiveTo: string | null,
    client?: OrmClient,
  ): Promise<MerchantCommissionRuleRecord | null> {
    const db = client ?? { orm: this.db().orm };
    const patch: {
      active: boolean;
      effectiveTo?: ReturnType<typeof pgTimestamptz>;
    } = { active: false };
    if (effectiveTo) {
      patch.effectiveTo = pgTimestamptz(effectiveTo);
    }
    await orm(db).MerchantCommissionRule.where({ id: ruleId }).update(patch);
    return this.findById(ruleId, db);
  }

  private async queryOnClient<T>(
    client: OrmClient,
    plan: unknown,
  ): Promise<T[]> {
    if (typeof client.query !== 'function') {
      throw merchantCommissionConfigurationInvalid(
        'Merchant commission requires a transactional database client',
      );
    }
    return consumeQueryRows<T>(client.query(plan));
  }
}

function toRecord(row: {
  id: string;
  scope: string;
  merchantId: string | null;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}): MerchantCommissionRuleRecord {
  return {
    id: row.id,
    scope: row.scope,
    merchantId: row.merchantId,
    rateBps: row.rateBps,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    active: row.active,
  };
}
