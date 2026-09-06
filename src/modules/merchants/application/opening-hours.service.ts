import { Injectable } from '@nestjs/common';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { merchantBranchNotFound } from '../domain/merchant.errors';
import { OPENING_HOURS_TIMEZONE } from '../domain/opening-hours.constants';
import { openingHoursVersionConflict } from '../domain/opening-hours.errors';
import {
  evaluateOpeningHours,
  type OpeningHoursEvaluation,
} from '../domain/opening-hours.evaluator';
import {
  flattenNormalizedDays,
  formatMinuteAsHhMm,
  groupIntervalsByDay,
  validateAndNormalizeWeeklySchedule,
  type OpeningDayInput,
  type NormalizedOpeningInterval,
} from '../domain/opening-hours.policy';
import {
  OpeningHoursRepository,
  type OpeningScheduleRecord,
} from '../infrastructure/opening-hours.repository';
import { MerchantAccessService } from './merchant-access.service';

export type OpeningHoursPublicDay = {
  dayOfWeek: number;
  intervals: Array<{
    opens: string;
    closes: string;
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
  }>;
};

export type OpeningHoursMerchantView = {
  branchId: string;
  timezone: string;
  hoursConfigured: boolean;
  version: number | null;
  updatedAt: string | null;
  days: OpeningHoursPublicDay[];
};

export type OpeningHoursCustomerProjection = OpeningHoursEvaluation & {
  days?: OpeningHoursPublicDay[];
};

@Injectable()
export class OpeningHoursService {
  constructor(
    private readonly openingHours: OpeningHoursRepository,
    private readonly access: MerchantAccessService,
  ) {}

  async getForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<OpeningHoursMerchantView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    const branch = await this.openingHours.findOwnedBranch(
      merchantId,
      branchId,
    );
    if (!branch) {
      throw merchantBranchNotFound();
    }
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    return this.toMerchantView(branchId, schedule);
  }

  async putForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: { expectedVersion: number; days: OpeningDayInput[] },
  ): Promise<OpeningHoursMerchantView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    const branch = await this.openingHours.findOwnedBranch(
      merchantId,
      branchId,
    );
    if (!branch) {
      throw merchantBranchNotFound();
    }

    const normalized = validateAndNormalizeWeeklySchedule(input.days);
    const flat = flattenNormalizedDays(normalized);
    const existing = await this.openingHours.findScheduleByBranchId(branchId);

    if (input.expectedVersion === 0) {
      if (existing) {
        throw openingHoursVersionConflict();
      }
      const created = await this.openingHours.createSchedule({
        branchId,
        updatedByAccountId: accountId,
        intervals: flat,
      });
      return this.toMerchantView(branchId, created);
    }

    if (!existing || existing.version !== input.expectedVersion) {
      throw openingHoursVersionConflict();
    }
    const replaced = await this.openingHours.replaceSchedule({
      scheduleId: existing.id,
      branchId,
      expectedVersion: input.expectedVersion,
      updatedByAccountId: accountId,
      intervals: flat,
    });
    if (!replaced) {
      throw openingHoursVersionConflict();
    }
    return this.toMerchantView(branchId, replaced);
  }

  /** Load + evaluate for checkout/order gates. Missing schedule ⇒ not configured. */
  async evaluateBranch(
    branchId: string,
    now: Date,
  ): Promise<OpeningHoursEvaluation> {
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    return evaluateOpeningHours(schedule?.intervals ?? null, now);
  }

  /**
   * Batch evaluate many branches (catalog list/search). No N+1.
   */
  async evaluateBranches(
    branchIds: string[],
    now: Date,
  ): Promise<Map<string, OpeningHoursEvaluation>> {
    const schedules =
      await this.openingHours.findSchedulesByBranchIds(branchIds);
    const out = new Map<string, OpeningHoursEvaluation>();
    for (const branchId of branchIds) {
      const schedule = schedules.get(branchId);
      out.set(branchId, evaluateOpeningHours(schedule?.intervals ?? null, now));
    }
    return out;
  }

  async getCustomerProjection(
    branchId: string,
    now: Date,
    options?: { includeDays?: boolean },
  ): Promise<OpeningHoursCustomerProjection> {
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    const evaluation = evaluateOpeningHours(schedule?.intervals ?? null, now);
    if (!options?.includeDays) {
      return evaluation;
    }
    return {
      ...evaluation,
      days: this.toPublicDays(schedule?.intervals ?? []),
    };
  }

  async getCustomerProjections(
    branchIds: string[],
    now: Date,
  ): Promise<Map<string, OpeningHoursEvaluation>> {
    return this.evaluateBranches(branchIds, now);
  }

  private toMerchantView(
    branchId: string,
    schedule: OpeningScheduleRecord | null,
  ): OpeningHoursMerchantView {
    if (!schedule) {
      return {
        branchId,
        timezone: OPENING_HOURS_TIMEZONE,
        hoursConfigured: false,
        version: null,
        updatedAt: null,
        days: groupIntervalsByDay([]).map((day) => ({
          dayOfWeek: day.dayOfWeek,
          intervals: [],
        })),
      };
    }
    return {
      branchId,
      timezone: OPENING_HOURS_TIMEZONE,
      hoursConfigured: true,
      version: schedule.version,
      updatedAt: schedule.updatedAt,
      days: this.toPublicDays(schedule.intervals),
    };
  }

  private toPublicDays(
    intervals: NormalizedOpeningInterval[],
  ): OpeningHoursPublicDay[] {
    return groupIntervalsByDay(intervals).map((day) => ({
      dayOfWeek: day.dayOfWeek,
      intervals: day.intervals.map((interval) => ({
        opens: formatMinuteAsHhMm(interval.opensMinute),
        closes: formatMinuteAsHhMm(interval.closesMinute),
        opensMinute: interval.opensMinute,
        closesMinute: interval.closesMinute,
        closesNextDay: interval.closesNextDay,
      })),
    }));
  }
}
