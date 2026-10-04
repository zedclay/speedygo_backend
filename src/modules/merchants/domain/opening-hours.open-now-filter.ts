import {
  OPENING_HOURS_TIMEZONE,
  type IsoDayOfWeek,
} from './opening-hours.constants';
import {
  getLocalCivilParts,
  isoDayPlus,
  localDatePlusDaysAtMinute,
} from './opening-hours.timezone';

/**
 * Local civil parts captured once per request for openNow listing filters.
 * Must stay aligned with {@link isOpenAt} / SQL EXISTS in customer catalog.
 */
export type OpenNowLocalParts = {
  dayOfWeek: IsoDayOfWeek;
  previousDayOfWeek: IsoDayOfWeek;
  minuteOfDay: number;
  /** Civil date YYYY-MM-DD (hours exceptions). */
  localDate: string;
  previousLocalDate: string;
};

function dateKey(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function captureOpenNowLocalParts(
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
): OpenNowLocalParts {
  const local = getLocalCivilParts(now, timeZone);
  const previousNoon = localDatePlusDaysAtMinute(local, -1, 12 * 60, timeZone);
  return {
    dayOfWeek: local.dayOfWeek,
    previousDayOfWeek: isoDayPlus(local.dayOfWeek, -1),
    minuteOfDay: local.minuteOfDay,
    localDate: dateKey(local),
    previousLocalDate: dateKey(getLocalCivilParts(previousNoon, timeZone)),
  };
}

/**
 * Half-open interval check at a local day+minute (no Date objects).
 * Mirrors customer catalog SQL EXISTS used when openNow=true:
 * - same day: minute >= opens AND (closesNextDay OR minute < closes)
 * - previous day overnight spill: closesNextDay AND minute < closes
 *
 * Unknown/unconfigured schedules have no intervals → not open.
 */
export function intervalMatchesOpenNowLocal(
  interval: {
    dayOfWeek: number;
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
  },
  local: OpenNowLocalParts,
): boolean {
  if (
    interval.dayOfWeek === local.dayOfWeek &&
    local.minuteOfDay >= interval.opensMinute &&
    (interval.closesNextDay || local.minuteOfDay < interval.closesMinute)
  ) {
    return true;
  }
  if (
    interval.dayOfWeek === local.previousDayOfWeek &&
    interval.closesNextDay &&
    local.minuteOfDay < interval.closesMinute
  ) {
    return true;
  }
  return false;
}

export function intervalsOpenAtLocal(
  intervals: readonly {
    dayOfWeek: number;
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
  }[],
  local: OpenNowLocalParts,
): boolean {
  for (const interval of intervals) {
    if (intervalMatchesOpenNowLocal(interval, local)) {
      return true;
    }
  }
  return false;
}

/**
 * Exception-aware mirror of the customer catalog openNow SQL:
 * - today's exception (open) matches only its own same-day intervals;
 * - today's exception (closed) never matches;
 * - without a today exception, weekly today intervals match, and previous-day
 *   overnight spill matches only when the previous date has no exception.
 * Weekly schedule must exist (exceptions never configure hours).
 */
export function openNowAtLocalWithExceptions(
  weekly:
    | readonly {
        dayOfWeek: number;
        opensMinute: number;
        closesMinute: number;
        closesNextDay: boolean;
      }[]
    | null,
  exceptions: readonly {
    localDate: string;
    closed: boolean;
    intervals: readonly {
      opensMinute: number;
      closesMinute: number;
      closesNextDay: boolean;
    }[];
  }[],
  local: OpenNowLocalParts,
): boolean {
  if (weekly === null) {
    return false;
  }
  const today = exceptions.find((item) => item.localDate === local.localDate);
  if (today) {
    if (today.closed) {
      return false;
    }
    return today.intervals.some(
      (interval) =>
        local.minuteOfDay >= interval.opensMinute &&
        (interval.closesNextDay || local.minuteOfDay < interval.closesMinute),
    );
  }
  const previousHasException = exceptions.some(
    (item) => item.localDate === local.previousLocalDate,
  );
  for (const interval of weekly) {
    if (
      interval.dayOfWeek === local.dayOfWeek &&
      local.minuteOfDay >= interval.opensMinute &&
      (interval.closesNextDay || local.minuteOfDay < interval.closesMinute)
    ) {
      return true;
    }
    if (
      !previousHasException &&
      interval.dayOfWeek === local.previousDayOfWeek &&
      interval.closesNextDay &&
      local.minuteOfDay < interval.closesMinute
    ) {
      return true;
    }
  }
  return false;
}
