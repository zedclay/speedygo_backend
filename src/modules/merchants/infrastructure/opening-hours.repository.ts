import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow } from '../../../infrastructure/database/pg-values';
import type { NormalizedOpeningInterval } from '../domain/opening-hours.policy';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

export type OpeningScheduleRecord = {
  id: string;
  branchId: string;
  version: number;
  updatedByAccountId: string;
  createdAt: string;
  updatedAt: string;
  intervals: NormalizedOpeningInterval[];
};

@Injectable()
export class OpeningHoursRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findOwnedBranch(
    merchantId: string,
    branchId: string,
  ): Promise<{ id: string; merchantId: string } | null> {
    const row = await orm(this.db())
      .MerchantBranch.where({ id: branchId, merchantId })
      .first();
    return row ? { id: row.id, merchantId: row.merchantId } : null;
  }

  async findScheduleByBranchId(
    branchId: string,
  ): Promise<OpeningScheduleRecord | null> {
    const schedule = await orm(this.db())
      .MerchantBranchOpeningSchedule.where({ branchId })
      .first();
    if (!schedule) {
      return null;
    }
    const intervals = await orm(this.db())
      .MerchantBranchOpeningInterval.where({ scheduleId: schedule.id })
      .all();
    return this.toRecord(schedule, this.sortIntervals(intervals));
  }

  /**
   * Batch-load schedules for many branches (no N+1).
   * Missing branchId ⇒ absent from map (hours not configured).
   */
  async findSchedulesByBranchIds(
    branchIds: string[],
  ): Promise<Map<string, OpeningScheduleRecord>> {
    const result = new Map<string, OpeningScheduleRecord>();
    if (branchIds.length === 0) {
      return result;
    }
    const schedules = await orm(this.db())
      .MerchantBranchOpeningSchedule.where((row) => row.branchId.in(branchIds))
      .all();
    if (schedules.length === 0) {
      return result;
    }
    const scheduleIds = schedules.map((schedule) => schedule.id);
    const intervals = this.sortIntervals(
      await orm(this.db())
        .MerchantBranchOpeningInterval.where((row) =>
          row.scheduleId.in(scheduleIds),
        )
        .all(),
    );
    const bySchedule = new Map<string, typeof intervals>();
    for (const interval of intervals) {
      const list = bySchedule.get(interval.scheduleId) ?? [];
      list.push(interval);
      bySchedule.set(interval.scheduleId, list);
    }
    for (const schedule of schedules) {
      result.set(
        schedule.branchId,
        this.toRecord(schedule, bySchedule.get(schedule.id) ?? []),
      );
    }
    return result;
  }

  async createSchedule(input: {
    branchId: string;
    updatedByAccountId: string;
    intervals: NormalizedOpeningInterval[];
  }): Promise<OpeningScheduleRecord> {
    const now = pgNow();
    const scheduleId = createUuidV7();
    await this.db().transaction(async (tx) => {
      await orm(tx).MerchantBranchOpeningSchedule.create({
        id: scheduleId,
        branchId: input.branchId,
        version: 1,
        updatedByAccountId: input.updatedByAccountId,
        createdAt: now,
        updatedAt: now,
      });
      await this.insertIntervals(tx, scheduleId, input.intervals);
    });
    const created = await this.findScheduleByBranchId(input.branchId);
    if (!created) {
      throw new Error('Failed to create opening schedule');
    }
    return created;
  }

  async replaceSchedule(input: {
    scheduleId: string;
    branchId: string;
    expectedVersion: number;
    updatedByAccountId: string;
    intervals: NormalizedOpeningInterval[];
  }): Promise<OpeningScheduleRecord | null> {
    const now = pgNow();
    const updated = await this.db().transaction(async (tx) => {
      // Row UPDATE acquires the concurrent lock (Prisma 8 has no FOR UPDATE).
      await orm(tx)
        .MerchantBranchOpeningSchedule.where({ id: input.scheduleId })
        .update({ updatedAt: now });
      const existing = await orm(tx)
        .MerchantBranchOpeningSchedule.where({
          id: input.scheduleId,
          branchId: input.branchId,
        })
        .first();
      if (!existing || existing.version !== input.expectedVersion) {
        return null;
      }
      await orm(tx)
        .MerchantBranchOpeningInterval.where({ scheduleId: input.scheduleId })
        .delete();
      await this.insertIntervals(tx, input.scheduleId, input.intervals);
      await orm(tx)
        .MerchantBranchOpeningSchedule.where({ id: input.scheduleId })
        .update({
          version: input.expectedVersion + 1,
          updatedByAccountId: input.updatedByAccountId,
          updatedAt: now,
        });
      return true;
    });
    if (!updated) {
      return null;
    }
    return this.findScheduleByBranchId(input.branchId);
  }

  private async insertIntervals(
    client: OrmClient,
    scheduleId: string,
    intervals: NormalizedOpeningInterval[],
  ): Promise<void> {
    for (const interval of intervals) {
      await orm(client).MerchantBranchOpeningInterval.create({
        id: createUuidV7(),
        scheduleId,
        dayOfWeek: interval.dayOfWeek,
        opensMinute: interval.opensMinute,
        closesMinute: interval.closesMinute,
        closesNextDay: interval.closesNextDay,
        sortOrder: interval.sortOrder,
        createdAt: pgNow(),
      });
    }
  }

  private sortIntervals<T extends { dayOfWeek: number; sortOrder: number }>(
    intervals: T[],
  ): T[] {
    return intervals
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sortOrder - b.sortOrder);
  }

  private toRecord(
    schedule: {
      id: string;
      branchId: string;
      version: number;
      updatedByAccountId: string;
      createdAt: string;
      updatedAt: string;
    },
    intervals: Array<{
      dayOfWeek: number;
      opensMinute: number;
      closesMinute: number;
      closesNextDay: boolean;
      sortOrder: number;
    }>,
  ): OpeningScheduleRecord {
    return {
      id: schedule.id,
      branchId: schedule.branchId,
      version: schedule.version,
      updatedByAccountId: schedule.updatedByAccountId,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      intervals: intervals.map((interval) => ({
        dayOfWeek: interval.dayOfWeek as NormalizedOpeningInterval['dayOfWeek'],
        opensMinute: interval.opensMinute,
        closesMinute: interval.closesMinute,
        closesNextDay: interval.closesNextDay,
        sortOrder: interval.sortOrder,
      })),
    };
  }
}
