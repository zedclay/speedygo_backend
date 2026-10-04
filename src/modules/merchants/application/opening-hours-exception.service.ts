import { Injectable } from '@nestjs/common';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { merchantBranchNotFound } from '../domain/merchant.errors';
import { OPENING_HOURS_TIMEZONE } from '../domain/opening-hours.constants';
import { formatMinuteAsHhMm } from '../domain/opening-hours.policy';
import {
  isStrictCivilDate,
  localDateKeyPlusDays,
  OPENING_HOURS_EXCEPTION_MAX_UPCOMING,
  validateAndNormalizeException,
} from '../domain/opening-hours-exception.policy';
import {
  openingHoursExceptionInvalid,
  openingHoursExceptionNotFound,
  openingHoursExceptionVersionConflict,
  openingHoursExceptionWeeklyRequired,
} from '../domain/opening-hours-exception.errors';
import {
  OpeningHoursExceptionRepository,
  type OpeningHoursExceptionRecord,
} from '../infrastructure/opening-hours-exception.repository';
import { OpeningHoursRepository } from '../infrastructure/opening-hours.repository';
import { MerchantAccessService } from './merchant-access.service';

export type OpeningHoursExceptionView = {
  date: string;
  closed: boolean;
  label: string;
  customerMessage: string | null;
  intervals: Array<{ opens: string; closes: string }>;
  version: number;
  updatedAt: string;
};

export type OpeningHoursExceptionListView = {
  branchId: string;
  timezone: string;
  today: string;
  items: OpeningHoursExceptionView[];
};

export function toExceptionView(
  record: OpeningHoursExceptionRecord,
): OpeningHoursExceptionView {
  return {
    date: record.localDate,
    closed: record.closed,
    label: record.label,
    customerMessage: record.customerMessage,
    intervals: record.intervals.map((interval) => ({
      opens: formatMinuteAsHhMm(interval.opensMinute),
      closes: formatMinuteAsHhMm(interval.closesMinute),
    })),
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class OpeningHoursExceptionService {
  constructor(
    private readonly exceptions: OpeningHoursExceptionRepository,
    private readonly openingHours: OpeningHoursRepository,
    private readonly access: MerchantAccessService,
  ) {}

  async list(
    accountId: string,
    merchantId: string,
    branchId: string,
    now: Date = new Date(),
  ): Promise<OpeningHoursExceptionListView> {
    await this.requireBranch(
      accountId,
      merchantId,
      branchId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    const today = localDateKeyPlusDays(now, 0);
    const records = await this.exceptions.findFromDate(branchId, today);
    return {
      branchId,
      timezone: OPENING_HOURS_TIMEZONE,
      today,
      items: records.map(toExceptionView),
    };
  }

  async put(
    accountId: string,
    merchantId: string,
    branchId: string,
    date: string,
    input: {
      expectedVersion: number;
      closed: unknown;
      intervals: unknown;
      label: unknown;
      customerMessage?: unknown;
    },
    now: Date = new Date(),
  ): Promise<OpeningHoursExceptionView> {
    await this.requireBranch(
      accountId,
      merchantId,
      branchId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw openingHoursExceptionInvalid(
        'expectedVersion must be a non-negative integer',
      );
    }
    const normalized = validateAndNormalizeException(
      {
        date,
        closed: input.closed,
        intervals: input.intervals,
        label: input.label,
        customerMessage: input.customerMessage,
      },
      now,
    );
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    if (!schedule) {
      throw openingHoursExceptionWeeklyRequired();
    }

    if (input.expectedVersion === 0) {
      const today = localDateKeyPlusDays(now, 0);
      const upcoming = await this.exceptions.countFromDate(branchId, today);
      if (upcoming >= OPENING_HOURS_EXCEPTION_MAX_UPCOMING) {
        throw openingHoursExceptionInvalid(
          `At most ${OPENING_HOURS_EXCEPTION_MAX_UPCOMING} upcoming exceptions per branch`,
        );
      }
      const created = await this.exceptions.create({
        branchId,
        updatedByAccountId: accountId,
        exception: normalized,
      });
      if (created.status === 'conflict') {
        throw await this.conflict(branchId, normalized.localDate);
      }
      return toExceptionView(created.record);
    }

    const replaced = await this.exceptions.replace({
      branchId,
      expectedVersion: input.expectedVersion,
      updatedByAccountId: accountId,
      exception: normalized,
    });
    if (replaced.status === 'conflict') {
      throw await this.conflict(branchId, normalized.localDate);
    }
    return toExceptionView(replaced.record);
  }

  async remove(
    accountId: string,
    merchantId: string,
    branchId: string,
    date: string,
    expectedVersion: number,
  ): Promise<{ deleted: true; date: string }> {
    await this.requireBranch(
      accountId,
      merchantId,
      branchId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    if (!isStrictCivilDate(date)) {
      throw openingHoursExceptionInvalid('date must be a real YYYY-MM-DD date');
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw openingHoursExceptionInvalid(
        'expectedVersion must be a positive integer',
      );
    }
    const outcome = await this.exceptions.delete({
      branchId,
      localDate: date,
      expectedVersion,
    });
    if (outcome === 'missing') {
      throw openingHoursExceptionNotFound();
    }
    if (outcome === 'conflict') {
      throw await this.conflict(branchId, date);
    }
    return { deleted: true, date };
  }

  private async conflict(branchId: string, date: string) {
    const current = await this.exceptions.findByDate(branchId, date);
    return openingHoursExceptionVersionConflict(
      current
        ? (toExceptionView(current) as unknown as Record<string, unknown>)
        : null,
    );
  }

  private async requireBranch(
    accountId: string,
    merchantId: string,
    branchId: string,
    capability: (typeof MERCHANT_CAPABILITIES)[keyof typeof MERCHANT_CAPABILITIES],
  ): Promise<void> {
    await this.access.requireCapability(accountId, merchantId, capability);
    const branch = await this.openingHours.findOwnedBranch(
      merchantId,
      branchId,
    );
    if (!branch) {
      throw merchantBranchNotFound();
    }
  }
}
