import { Injectable } from '@nestjs/common';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { merchantBranchNotFound } from '../domain/merchant.errors';
import { OPENING_HOURS_TIMEZONE } from '../domain/opening-hours.constants';
import { availabilityVersionConflict } from '../domain/branch-availability.errors';
import {
  evaluateEffectiveAvailability,
  type EffectiveAvailability,
} from '../domain/branch-availability.evaluator';
import { validateAndNormalizeAvailabilityPut } from '../domain/branch-availability.policy';
import { OpeningHoursRepository } from '../infrastructure/opening-hours.repository';
import {
  OpeningHoursExceptionRepository,
  type OpeningHoursExceptionRecord,
} from '../infrastructure/opening-hours-exception.repository';
import { localDateKeyPlusDays } from '../domain/opening-hours-exception.policy';
import {
  BranchAvailabilityRepository,
  type AvailabilityOverrideRecord,
} from '../infrastructure/branch-availability.repository';
import { MerchantAccessService } from './merchant-access.service';

export type BranchAvailabilityMerchantView = EffectiveAvailability & {
  branchId: string;
  version: number | null;
  updatedAt: string | null;
  /** True when outside hours but override is FOLLOWING schedule (for UI warning). */
  outsideWeeklyHours: boolean;
  /** Exception governing today's Africa/Algiers date, if any. */
  hoursException: { date: string; closed: boolean; label: string } | null;
};

@Injectable()
export class BranchAvailabilityService {
  constructor(
    private readonly availability: BranchAvailabilityRepository,
    private readonly openingHours: OpeningHoursRepository,
    private readonly access: MerchantAccessService,
    private readonly exceptions: OpeningHoursExceptionRepository,
  ) {}

  async getForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
    now: Date = new Date(),
  ): Promise<BranchAvailabilityMerchantView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    const branch = await this.availability.findOwnedBranch(
      merchantId,
      branchId,
    );
    if (!branch) {
      throw merchantBranchNotFound();
    }
    return this.buildView(branchId, now);
  }

  async putForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: {
      expectedVersion: number;
      mode: string;
      reasonCode?: string | null;
      customerMessage?: string | null;
      closedUntil?: string | null;
    },
    now: Date = new Date(),
  ): Promise<BranchAvailabilityMerchantView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    const branch = await this.availability.findOwnedBranch(
      merchantId,
      branchId,
    );
    if (!branch) {
      throw merchantBranchNotFound();
    }

    const normalized = validateAndNormalizeAvailabilityPut(input, now);
    const existing = await this.availability.findByBranchId(branchId);

    // Optional expired cleanup before write — only if version still matches.
    if (
      existing &&
      existing.mode === 'TEMPORARY_CLOSED' &&
      existing.closedUntil &&
      existing.closedUntil.getTime() <= now.getTime() &&
      normalized.expectedVersion === existing.version &&
      normalized.mode === 'FOLLOW_SCHEDULE'
    ) {
      await this.availability.clearExpiredTemporaryIfUnchanged({
        branchId,
        expectedVersion: existing.version,
        updatedByAccountId: accountId,
        now,
      });
    }

    const latest = await this.availability.findByBranchId(branchId);

    if (normalized.expectedVersion === 0) {
      if (latest) {
        throw availabilityVersionConflict(
          await this.conflictPayload(branchId, now),
        );
      }
      await this.availability.create({
        branchId,
        updatedByAccountId: accountId,
        mode: normalized.mode,
        reasonCode: normalized.reasonCode,
        customerMessage: normalized.customerMessage,
        closedUntil: normalized.closedUntil,
      });
      return this.buildView(branchId, now);
    }

    if (!latest || latest.version !== normalized.expectedVersion) {
      throw availabilityVersionConflict(
        await this.conflictPayload(branchId, now),
      );
    }

    const updated = await this.availability.update({
      branchId,
      expectedVersion: normalized.expectedVersion,
      updatedByAccountId: accountId,
      mode: normalized.mode,
      reasonCode: normalized.reasonCode,
      customerMessage: normalized.customerMessage,
      closedUntil: normalized.closedUntil,
    });
    if (!updated) {
      throw availabilityVersionConflict(
        await this.conflictPayload(branchId, now),
      );
    }
    return this.buildView(branchId, now);
  }

  private async conflictPayload(
    branchId: string,
    now: Date,
  ): Promise<Record<string, unknown>> {
    const view = await this.buildView(branchId, now);
    return {
      branchId: view.branchId,
      timezone: view.timezone,
      availabilityMode: view.availabilityMode,
      effectiveMode: view.effectiveMode,
      hoursConfigured: view.hoursConfigured,
      isOpenNow: view.isOpenNow,
      acceptingOrders: view.acceptingOrders,
      temporaryExpired: view.temporaryExpired,
      outsideWeeklyHours: view.outsideWeeklyHours,
      hoursException: view.hoursException,
      reasonCode: view.reasonCode,
      customerMessage: view.customerMessage,
      closedUntil: view.closedUntil,
      nextOpenAt: view.nextOpenAt ? view.nextOpenAt.toISOString() : null,
      currentClosesAt: view.currentClosesAt
        ? view.currentClosesAt.toISOString()
        : null,
      version: view.version,
      updatedAt: view.updatedAt,
    };
  }

  async evaluateBranch(
    branchId: string,
    now: Date,
  ): Promise<EffectiveAvailability> {
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    const override = await this.availability.findByBranchId(branchId);
    const exceptions = await this.loadExceptions(branchId, now);
    return evaluateEffectiveAvailability(
      schedule?.intervals ?? null,
      override,
      now,
      OPENING_HOURS_TIMEZONE,
      exceptions,
    );
  }

  async evaluateBranches(
    branchIds: string[],
    now: Date,
  ): Promise<Map<string, EffectiveAvailability>> {
    const schedules =
      await this.openingHours.findSchedulesByBranchIds(branchIds);
    const overrides = await this.availability.findByBranchIds(branchIds);
    const exceptions = await this.exceptions.findFromDateForBranches(
      branchIds,
      localDateKeyPlusDays(now, -1),
    );
    const out = new Map<string, EffectiveAvailability>();
    for (const branchId of branchIds) {
      out.set(
        branchId,
        evaluateEffectiveAvailability(
          schedules.get(branchId)?.intervals ?? null,
          overrides.get(branchId) ?? null,
          now,
          OPENING_HOURS_TIMEZONE,
          exceptions.get(branchId) ?? [],
        ),
      );
    }
    return out;
  }

  private async buildView(
    branchId: string,
    now: Date,
  ): Promise<BranchAvailabilityMerchantView> {
    const schedule = await this.openingHours.findScheduleByBranchId(branchId);
    const override = await this.availability.findByBranchId(branchId);
    const exceptions = await this.loadExceptions(branchId, now);
    const effective = evaluateEffectiveAvailability(
      schedule?.intervals ?? null,
      override,
      now,
      OPENING_HOURS_TIMEZONE,
      exceptions,
    );
    const outsideWeeklyHours =
      effective.hoursConfigured &&
      !effective.acceptingOrders &&
      effective.effectiveMode === 'FOLLOW_SCHEDULE';
    const today = localDateKeyPlusDays(now, 0);
    const todayException = exceptions.find((item) => item.localDate === today);

    return {
      ...effective,
      branchId,
      version: override?.version ?? null,
      updatedAt: override?.updatedAt ?? null,
      outsideWeeklyHours,
      hoursException: todayException
        ? {
            date: todayException.localDate,
            closed: todayException.closed,
            label: todayException.label,
          }
        : null,
      timezone: OPENING_HOURS_TIMEZONE,
      currentClosesAt: effective.currentClosesAt,
      nextOpenAt: effective.nextOpenAt,
    };
  }

  private loadExceptions(
    branchId: string,
    now: Date,
  ): Promise<OpeningHoursExceptionRecord[]> {
    return this.exceptions.findFromDate(
      branchId,
      localDateKeyPlusDays(now, -1),
    );
  }
}

export type { AvailabilityOverrideRecord };
