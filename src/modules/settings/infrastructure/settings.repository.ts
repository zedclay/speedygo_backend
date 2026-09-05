import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import {
  SETTINGS_ADVISORY_LOCK_CLASS,
  settingsAdvisoryObjectId,
} from '../domain/settings.lock';
import type { PlatformSettingRow } from '../domain/settings.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient | SpeedyGoDb) {
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
  return [];
}

function toRow(row: {
  id: string;
  key: string;
  valueJson: unknown;
  updatedByAdminId: string;
  updatedAt: string;
}): PlatformSettingRow {
  return {
    id: row.id,
    key: row.key,
    valueJson: row.valueJson,
    updatedByAdminId: row.updatedByAdminId,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx) => fn(tx as OrmClient));
  }

  async findByKey(key: string): Promise<PlatformSettingRow | null> {
    const row = await orm(this.db())
      .PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    return row ? toRow(row) : null;
  }

  async findByKeyInTx(
    client: OrmClient,
    key: string,
  ): Promise<PlatformSettingRow | null> {
    const row = await orm(client)
      .PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    return row ? toRow(row) : null;
  }

  async findAllowlisted(
    keys: readonly string[],
  ): Promise<PlatformSettingRow[]> {
    const rows: PlatformSettingRow[] = [];
    for (const key of keys) {
      const row = await this.findByKey(key);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Transaction-scoped advisory lock so concurrent Admins serialize on the same key.
   */
  async lockKeyInTx(client: OrmClient, key: string): Promise<void> {
    if (typeof client.query !== 'function') {
      return;
    }
    const objectId = settingsAdvisoryObjectId(key);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${SETTINGS_ADVISORY_LOCK_CLASS}, ${objectId}) IS NULL
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

  async createInTx(
    client: OrmClient,
    input: {
      key: string;
      valueJson: unknown;
      updatedByAdminId: string;
    },
  ): Promise<PlatformSettingRow> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).PlatformSetting.create({
      id,
      key: pgVarchar<128>(input.key),
      valueJson: JSON.parse(JSON.stringify(input.valueJson)) as never,
      updatedByAdminId: input.updatedByAdminId,
      updatedAt: now,
    });
    const row = await orm(client).PlatformSetting.where({ id }).first();
    if (!row) {
      throw new Error('PlatformSetting create failed');
    }
    return toRow(row);
  }

  async updateValueInTx(
    client: OrmClient,
    input: {
      id: string;
      valueJson: unknown;
      updatedByAdminId: string;
    },
  ): Promise<PlatformSettingRow> {
    const now = pgNow();
    await orm(client)
      .PlatformSetting.where({ id: input.id })
      .update({
        valueJson: JSON.parse(JSON.stringify(input.valueJson)) as never,
        updatedByAdminId: input.updatedByAdminId,
        updatedAt: now,
      });
    const row = await orm(client)
      .PlatformSetting.where({ id: input.id })
      .first();
    if (!row) {
      throw new Error('PlatformSetting update failed');
    }
    return toRow(row);
  }
}
