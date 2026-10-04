import { OPENING_HOURS_TIMEZONE } from './opening-hours.constants';
import {
  evaluateOpeningHours,
  isOpenAt,
  nextOpenAt,
  type OpeningHoursEvaluation,
  type OpeningHoursExceptionDay,
} from './opening-hours.evaluator';
import type { NormalizedOpeningInterval } from './opening-hours.policy';
import type {
  AvailabilityMode,
  AvailabilityReasonCode,
} from './branch-availability.constants';

export type AvailabilityOverrideSnapshot = {
  mode: AvailabilityMode;
  reasonCode: AvailabilityReasonCode | null;
  customerMessage: string | null;
  closedUntil: Date | null;
  version: number;
  updatedAt: string;
};

export type EffectiveAvailability = OpeningHoursEvaluation & {
  /** True when new customer orders may be accepted. */
  acceptingOrders: boolean;
  /** Persisted mode, or FOLLOW_SCHEDULE when no row / expired temporary (eval view). */
  availabilityMode: AvailabilityMode;
  /** True when TEMPORARY_CLOSED row exists but closedUntil is past (treated as schedule). */
  temporaryExpired: boolean;
  reasonCode: AvailabilityReasonCode | null;
  customerMessage: string | null;
  /** Override expiry only; never a promise the store is open then. */
  closedUntil: string | null;
  /** Effective mode used for acceptingOrders (expired temp → FOLLOW_SCHEDULE). */
  effectiveMode: AvailabilityMode;
};

function parseClosedUntil(
  value: Date | string | null | undefined,
): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Active override blocks new orders. Expired temporary does not.
 * GET/eval must not require a DB write.
 */
export function resolveEffectiveMode(
  override: AvailabilityOverrideSnapshot | null | undefined,
  now: Date,
): {
  effectiveMode: AvailabilityMode;
  temporaryExpired: boolean;
  activeClosedUntil: Date | null;
} {
  if (!override) {
    return {
      effectiveMode: 'FOLLOW_SCHEDULE',
      temporaryExpired: false,
      activeClosedUntil: null,
    };
  }
  if (override.mode === 'FORCE_CLOSED') {
    return {
      effectiveMode: 'FORCE_CLOSED',
      temporaryExpired: false,
      activeClosedUntil: null,
    };
  }
  if (override.mode === 'TEMPORARY_CLOSED') {
    const until = parseClosedUntil(override.closedUntil);
    if (until && until.getTime() > now.getTime()) {
      return {
        effectiveMode: 'TEMPORARY_CLOSED',
        temporaryExpired: false,
        activeClosedUntil: until,
      };
    }
    return {
      effectiveMode: 'FOLLOW_SCHEDULE',
      temporaryExpired: true,
      activeClosedUntil: null,
    };
  }
  return {
    effectiveMode: 'FOLLOW_SCHEDULE',
    temporaryExpired: false,
    activeClosedUntil: null,
  };
}

/**
 * Next actual open under effective rules.
 * FORCE_CLOSED → null. Active temporary → first open at/after closedUntil under hours.
 */
export function effectiveNextOpenAt(
  effectiveMode: AvailabilityMode,
  activeClosedUntil: Date | null,
  intervals: readonly NormalizedOpeningInterval[] | null | undefined,
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = [],
): Date | null {
  if (effectiveMode === 'FORCE_CLOSED') {
    return null;
  }
  if (intervals == null) {
    return null;
  }
  if (effectiveMode === 'TEMPORARY_CLOSED' && activeClosedUntil) {
    if (isOpenAt(intervals, activeClosedUntil, timeZone, exceptions)) {
      return activeClosedUntil.getTime() > now.getTime()
        ? activeClosedUntil
        : null;
    }
    return nextOpenAt(intervals, activeClosedUntil, timeZone, exceptions);
  }
  const hours = evaluateOpeningHours(intervals, now, timeZone, exceptions);
  return hours.nextOpenAt;
}

/**
 * Precedence: active override (FORCE_CLOSED / TEMPORARY_CLOSED) → hours
 * exception for the local date → weekly schedule. Platform eligibility is
 * checked by callers before this.
 */
export function evaluateEffectiveAvailability(
  intervals: readonly NormalizedOpeningInterval[] | null | undefined,
  override: AvailabilityOverrideSnapshot | null | undefined,
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = [],
): EffectiveAvailability {
  const hours = evaluateOpeningHours(intervals, now, timeZone, exceptions);
  const { effectiveMode, temporaryExpired, activeClosedUntil } =
    resolveEffectiveMode(override, now);

  let acceptingOrders = false;
  let isOpenNow = false;
  let currentClosesAt: Date | null = null;

  if (
    effectiveMode === 'FORCE_CLOSED' ||
    effectiveMode === 'TEMPORARY_CLOSED'
  ) {
    acceptingOrders = false;
    isOpenNow = false;
    currentClosesAt = null;
  } else {
    acceptingOrders = hours.hoursConfigured && hours.isOpenNow;
    isOpenNow = acceptingOrders;
    currentClosesAt = hours.currentClosesAt;
  }

  const next = effectiveNextOpenAt(
    effectiveMode,
    activeClosedUntil,
    intervals,
    now,
    timeZone,
    exceptions,
  );

  return {
    hoursConfigured: hours.hoursConfigured,
    isOpenNow,
    acceptingOrders,
    timezone: timeZone,
    currentClosesAt,
    nextOpenAt: next,
    availabilityMode: override?.mode ?? 'FOLLOW_SCHEDULE',
    temporaryExpired,
    reasonCode:
      effectiveMode === 'FOLLOW_SCHEDULE' && temporaryExpired
        ? null
        : (override?.reasonCode ?? null),
    customerMessage:
      effectiveMode === 'FOLLOW_SCHEDULE' && temporaryExpired
        ? null
        : (override?.customerMessage ?? null),
    closedUntil:
      effectiveMode === 'TEMPORARY_CLOSED' && activeClosedUntil
        ? activeClosedUntil.toISOString()
        : null,
    effectiveMode,
  };
}

/** True when an override row currently blocks new orders. */
export function overrideBlocksNewOrders(
  override: AvailabilityOverrideSnapshot | null | undefined,
  now: Date,
): boolean {
  const { effectiveMode } = resolveEffectiveMode(override, now);
  return (
    effectiveMode === 'FORCE_CLOSED' || effectiveMode === 'TEMPORARY_CLOSED'
  );
}
