import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgDate,
  pgNow,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import type {
  NormalizedExceptionInterval,
  NormalizedOpeningHoursException,
} from '../domain/opening-hours-exception.policy';
import type { OrmClient } from './opening-hours.repository';

function orm(client: OrmClient) {
  return client.orm.public;
}

export type OpeningHoursExceptionRecord = {
  id: string;
  branchId: string;
  localDate: string;
  closed: boolean;
  label: string;
  customerMessage: string | null;
  version: number;
  updatedByAccountId: string;
  createdAt: string;
  updatedAt: string;
  intervals: NormalizedExceptionInterval[];
};

type ExceptionRow = {
  id: string;
  branchId: string;
  localDate: string;
  closed: boolean;
  label: string;
  customerMessage: string | null;
  version: number;
  updatedByAccountId: string;
  createdAt: string;
  updatedAt: string;
};

type IntervalRow = {
  exceptionId: string;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  sortOrder: number;
};

export type ExceptionWriteOutcome =
  | { status: 'ok'; record: OpeningHoursExceptionRecord }
  | { status: 'conflict' };

export type ExceptionDeleteOutcome = 'deleted' | 'missing' | 'conflict';

@Injectable()
export class OpeningHoursExceptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByDate(
    branchId: string,
    localDate: string,
    client?: OrmClient,
  ): Promise<OpeningHoursExceptionRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchHoursException.where({
        branchId,
        localDate: pgDate(localDate),
      })
      .first();
    if (!row) {
      return null;
    }
    const intervals = await this.loadIntervals([row.id], client);
    return toRecord(row as ExceptionRow, intervals.get(row.id) ?? []);
  }

  /** Exceptions dated `fromDate` or later, in date order. */
  async findFromDate(
    branchId: string,
    fromDate: string,
  ): Promise<OpeningHoursExceptionRecord[]> {
    const map = await this.findFromDateForBranches([branchId], fromDate);
    return map.get(branchId) ?? [];
  }

  /** Batch load for evaluation (no N+1). Branches without exceptions are absent. */
  async findFromDateForBranches(
    branchIds: string[],
    fromDate: string,
  ): Promise<Map<string, OpeningHoursExceptionRecord[]>> {
    const result = new Map<string, OpeningHoursExceptionRecord[]>();
    if (branchIds.length === 0) {
      return result;
    }
    const rows = (await orm(this.db())
      .MerchantBranchHoursException.where((row) => row.branchId.in(branchIds))
      .where((row) => row.localDate.gte(pgDate(fromDate)))
      .all()) as ExceptionRow[];
    if (rows.length === 0) {
      return result;
    }
    const intervals = await this.loadIntervals(rows.map((row) => row.id));
    for (const row of rows.slice().sort(compareRows)) {
      const list = result.get(row.branchId) ?? [];
      list.push(toRecord(row, intervals.get(row.id) ?? []));
      result.set(row.branchId, list);
    }
    return result;
  }

  async countFromDate(branchId: string, fromDate: string): Promise<number> {
    const rows = await orm(this.db())
      .MerchantBranchHoursException.where({ branchId })
      .where((row) => row.localDate.gte(pgDate(fromDate)))
      .all();
    return rows.length;
  }

  /** Insert for a date that has no exception; a concurrent insert yields conflict. */
  async create(input: {
    branchId: string;
    updatedByAccountId: string;
    exception: NormalizedOpeningHoursException;
  }): Promise<ExceptionWriteOutcome> {
    const id = createUuidV7();
    const now = pgNow();
    try {
      await this.db().transaction(async (tx: OrmClient) => {
        await orm(tx).MerchantBranchHoursException.create({
          id,
          branchId: input.branchId,
          localDate: pgDate(input.exception.localDate),
          closed: input.exception.closed,
          label: pgVarchar<80>(input.exception.label),
          customerMessage: input.exception.customerMessage
            ? pgVarchar<500>(input.exception.customerMessage)
            : null,
          version: 1,
          updatedByAccountId: input.updatedByAccountId,
          createdAt: now,
          updatedAt: now,
        });
        await this.insertIntervals(tx, id, input.exception.intervals);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return { status: 'conflict' };
      }
      throw error;
    }
    const record = await this.findByDate(
      input.branchId,
      input.exception.localDate,
    );
    if (!record) {
      throw new Error('Opening hours exception create failed');
    }
    return { status: 'ok', record };
  }

  /** Replace an existing exception when its version still matches. */
  async replace(input: {
    branchId: string;
    expectedVersion: number;
    updatedByAccountId: string;
    exception: NormalizedOpeningHoursException;
  }): Promise<ExceptionWriteOutcome> {
    const now = pgNow();
    const ok = await this.db().transaction(async (tx: OrmClient) => {
      const existing = await this.lockByDate(
        tx,
        input.branchId,
        input.exception.localDate,
      );
      if (!existing || existing.version !== input.expectedVersion) {
        return false;
      }
      // Prisma 8 `delete()` removes only the first matching row.
      await orm(tx)
        .MerchantBranchHoursExceptionInterval.where({
          exceptionId: existing.id,
        })
        .deleteAndCount();
      await this.insertIntervals(tx, existing.id, input.exception.intervals);
      await orm(tx)
        .MerchantBranchHoursException.where({ id: existing.id })
        .update({
          closed: input.exception.closed,
          label: pgVarchar<80>(input.exception.label),
          customerMessage: input.exception.customerMessage
            ? pgVarchar<500>(input.exception.customerMessage)
            : null,
          version: input.expectedVersion + 1,
          updatedByAccountId: input.updatedByAccountId,
          updatedAt: now,
        });
      return true;
    });
    if (!ok) {
      return { status: 'conflict' };
    }
    const record = await this.findByDate(
      input.branchId,
      input.exception.localDate,
    );
    if (!record) {
      return { status: 'conflict' };
    }
    return { status: 'ok', record };
  }

  async delete(input: {
    branchId: string;
    localDate: string;
    expectedVersion: number;
  }): Promise<ExceptionDeleteOutcome> {
    return this.db().transaction(async (tx: OrmClient) => {
      const existing = await this.lockByDate(
        tx,
        input.branchId,
        input.localDate,
      );
      if (!existing) {
        return 'missing';
      }
      if (existing.version !== input.expectedVersion) {
        return 'conflict';
      }
      await orm(tx)
        .MerchantBranchHoursException.where({ id: existing.id })
        .delete();
      return 'deleted';
    });
  }

  /** Row UPDATE takes the row lock (same pattern as the weekly schedule). */
  private async lockByDate(
    tx: OrmClient,
    branchId: string,
    localDate: string,
  ): Promise<ExceptionRow | null> {
    const where = { branchId, localDate: pgDate(localDate) };
    const row = await orm(tx).MerchantBranchHoursException.where(where).first();
    if (!row) {
      return null;
    }
    await orm(tx)
      .MerchantBranchHoursException.where({ id: row.id })
      .update({ updatedAt: row.updatedAt });
    const locked = await orm(tx)
      .MerchantBranchHoursException.where({ id: row.id })
      .first();
    return (locked as ExceptionRow | null) ?? null;
  }

  private async insertIntervals(
    client: OrmClient,
    exceptionId: string,
    intervals: NormalizedExceptionInterval[],
  ): Promise<void> {
    for (const interval of intervals) {
      await orm(client).MerchantBranchHoursExceptionInterval.create({
        id: createUuidV7(),
        exceptionId,
        opensMinute: interval.opensMinute,
        closesMinute: interval.closesMinute,
        closesNextDay: interval.closesNextDay,
        sortOrder: interval.sortOrder,
        createdAt: pgNow(),
      });
    }
  }

  private async loadIntervals(
    exceptionIds: string[],
    client?: OrmClient,
  ): Promise<Map<string, NormalizedExceptionInterval[]>> {
    const out = new Map<string, NormalizedExceptionInterval[]>();
    if (exceptionIds.length === 0) {
      return out;
    }
    const rows = (await orm(client ?? this.db())
      .MerchantBranchHoursExceptionInterval.where((row) =>
        row.exceptionId.in(exceptionIds),
      )
      .all()) as IntervalRow[];
    for (const row of rows
      .slice()
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.opensMinute - b.opensMinute,
      )) {
      const list = out.get(row.exceptionId) ?? [];
      list.push({
        opensMinute: row.opensMinute,
        closesMinute: row.closesMinute,
        closesNextDay: row.closesNextDay,
        sortOrder: row.sortOrder,
      });
      out.set(row.exceptionId, list);
    }
    return out;
  }
}

function compareRows(a: ExceptionRow, b: ExceptionRow): number {
  return String(a.localDate).localeCompare(String(b.localDate));
}

function toRecord(
  row: ExceptionRow,
  intervals: NormalizedExceptionInterval[],
): OpeningHoursExceptionRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    localDate: String(row.localDate).slice(0, 10),
    closed: row.closed,
    label: String(row.label),
    customerMessage: row.customerMessage ? String(row.customerMessage) : null,
    version: Number(row.version),
    updatedByAccountId: row.updatedByAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    intervals,
  };
}
