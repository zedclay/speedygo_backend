import {
  MINUTES_PER_DAY,
  OPENING_HOURS_TIMEZONE,
  type IsoDayOfWeek,
} from './opening-hours.constants';
import type { NormalizedOpeningInterval } from './opening-hours.policy';
import {
  getLocalCivilParts,
  isoDayPlus,
  localDatePlusDaysAtMinute,
  type LocalCivilParts,
} from './opening-hours.timezone';

/**
 * A dated replacement of the weekly schedule for one civil date in the
 * opening-hours timezone. Intervals never continue past that date's midnight.
 */
export type OpeningHoursExceptionDay = {
  localDate: string;
  closed: boolean;
  intervals: ReadonlyArray<{
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
  }>;
};

type IntervalTimes = Pick<
  NormalizedOpeningInterval,
  'opensMinute' | 'closesMinute' | 'closesNextDay'
>;

const NO_EXCEPTIONS: readonly OpeningHoursExceptionDay[] = [];

export type OpeningHoursEvaluation = {
  hoursConfigured: boolean;
  isOpenNow: boolean;
  timezone: string;
  currentClosesAt: Date | null;
  nextOpenAt: Date | null;
};

type TimedWindow = {
  opensAt: Date;
  closesAt: Date;
};

function buildWindowForDayOffset(
  interval: IntervalTimes,
  localNow: LocalCivilParts,
  dayOffset: number,
  timeZone: string,
): TimedWindow {
  const opensAt = localDatePlusDaysAtMinute(
    localNow,
    dayOffset,
    interval.opensMinute,
    timeZone,
  );
  const closeDayOffset = interval.closesNextDay ? dayOffset + 1 : dayOffset;
  const closesAt = localDatePlusDaysAtMinute(
    localNow,
    closeDayOffset,
    interval.closesMinute,
    timeZone,
  );
  return { opensAt, closesAt };
}

function civilDateKeyAtOffset(
  localNow: LocalCivilParts,
  dayOffset: number,
  timeZone: string,
): string {
  const noon = localDatePlusDaysAtMinute(
    localNow,
    dayOffset,
    12 * 60,
    timeZone,
  );
  const parts = getLocalCivilParts(noon, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Exception-aware windows: a civil date with an exception uses only its own
 * same-day intervals (none when closed); other dates use the weekly schedule,
 * with overnight spill cut at the next date's 00:00 when that date has an exception.
 */
function windowsAroundNowWithExceptions(
  intervals: readonly NormalizedOpeningInterval[],
  exceptions: readonly OpeningHoursExceptionDay[],
  now: Date,
  timeZone: string,
): TimedWindow[] {
  const localNow = getLocalCivilParts(now, timeZone);
  const byDate = new Map(exceptions.map((item) => [item.localDate, item]));
  const offsets = [-1, 0, 1, 2, 3, 4, 5, 6, 7];
  const dateKeys = new Map<number, string>();
  for (const offset of [...offsets, 8]) {
    dateKeys.set(offset, civilDateKeyAtOffset(localNow, offset, timeZone));
  }
  const windows: TimedWindow[] = [];
  for (const dayOffset of offsets) {
    const exception = byDate.get(dateKeys.get(dayOffset)!);
    if (exception) {
      if (!exception.closed) {
        for (const interval of exception.intervals) {
          windows.push(
            buildWindowForDayOffset(interval, localNow, dayOffset, timeZone),
          );
        }
      }
      continue;
    }
    const nextDateHasException = byDate.has(dateKeys.get(dayOffset + 1)!);
    const targetDay = isoDayPlus(localNow.dayOfWeek, dayOffset);
    for (const interval of intervals) {
      if (interval.dayOfWeek !== targetDay) {
        continue;
      }
      const window = buildWindowForDayOffset(
        interval,
        localNow,
        dayOffset,
        timeZone,
      );
      if (interval.closesNextDay && nextDateHasException) {
        const nextMidnight = localDatePlusDaysAtMinute(
          localNow,
          dayOffset + 1,
          0,
          timeZone,
        );
        if (window.closesAt.getTime() > nextMidnight.getTime()) {
          window.closesAt = nextMidnight;
        }
        if (window.opensAt.getTime() >= window.closesAt.getTime()) {
          continue;
        }
      }
      windows.push(window);
    }
  }
  return windows.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
}

function hasOpenException(
  exceptions: readonly OpeningHoursExceptionDay[],
): boolean {
  return exceptions.some((item) => !item.closed && item.intervals.length > 0);
}

function windowsAroundNow(
  intervals: readonly NormalizedOpeningInterval[],
  now: Date,
  timeZone: string,
  exceptions: readonly OpeningHoursExceptionDay[] = NO_EXCEPTIONS,
): TimedWindow[] {
  if (exceptions.length > 0) {
    return windowsAroundNowWithExceptions(intervals, exceptions, now, timeZone);
  }
  const localNow = getLocalCivilParts(now, timeZone);
  const windows: TimedWindow[] = [];
  // Cover previous day (overnight into today), today, and next 7 days for nextOpen scan.
  for (const dayOffset of [-1, 0, 1, 2, 3, 4, 5, 6, 7]) {
    const targetDay = isoDayPlus(localNow.dayOfWeek, dayOffset);
    for (const interval of intervals) {
      if (interval.dayOfWeek !== targetDay) {
        continue;
      }
      windows.push(
        buildWindowForDayOffset(interval, localNow, dayOffset, timeZone),
      );
    }
  }
  return windows.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
}

/** Half-open: exact open = open; exact close = closed. */
export function isOpenAt(
  intervals: readonly NormalizedOpeningInterval[],
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = NO_EXCEPTIONS,
): boolean {
  if (intervals.length === 0 && !hasOpenException(exceptions)) {
    return false;
  }
  const t = now.getTime();
  for (const window of windowsAroundNow(intervals, now, timeZone, exceptions)) {
    if (t >= window.opensAt.getTime() && t < window.closesAt.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * If currently open, return the end of the continuous open stretch
 * (extend through adjacent intervals that start exactly when the previous closes).
 */
export function currentClosesAt(
  intervals: readonly NormalizedOpeningInterval[],
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = NO_EXCEPTIONS,
): Date | null {
  if (!isOpenAt(intervals, now, timeZone, exceptions)) {
    return null;
  }
  const t = now.getTime();
  const windows = windowsAroundNow(intervals, now, timeZone, exceptions);
  const active = windows.find(
    (window) => t >= window.opensAt.getTime() && t < window.closesAt.getTime(),
  );
  if (!active) {
    return null;
  }
  let closes = active.closesAt;
  // Extend through adjacent continuous windows (half-open adjacency).
  let extended = true;
  while (extended) {
    extended = false;
    for (const window of windows) {
      if (window.opensAt.getTime() === closes.getTime()) {
        closes = window.closesAt;
        extended = true;
      }
    }
  }
  return closes;
}

/**
 * Next future open instant strictly after `now`, scanning at most ~7 local days.
 * Returns null when always closed (no intervals) or no open within the bound.
 */
export function nextOpenAt(
  intervals: readonly NormalizedOpeningInterval[],
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = NO_EXCEPTIONS,
): Date | null {
  if (intervals.length === 0 && !hasOpenException(exceptions)) {
    return null;
  }
  const t = now.getTime();
  const bound = t + 7 * 24 * 60 * 60 * 1000;
  for (const window of windowsAroundNow(intervals, now, timeZone, exceptions)) {
    if (window.opensAt.getTime() > t && window.opensAt.getTime() <= bound) {
      return window.opensAt;
    }
  }
  return null;
}

/** Missing weekly schedule stays HOURS_NOT_CONFIGURED; exceptions never configure hours. */
export function evaluateOpeningHours(
  intervals: readonly NormalizedOpeningInterval[] | null | undefined,
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
  exceptions: readonly OpeningHoursExceptionDay[] = NO_EXCEPTIONS,
): OpeningHoursEvaluation {
  if (intervals === null || intervals === undefined) {
    return {
      hoursConfigured: false,
      isOpenNow: false,
      timezone: timeZone,
      currentClosesAt: null,
      nextOpenAt: null,
    };
  }
  const open = isOpenAt(intervals, now, timeZone, exceptions);
  return {
    hoursConfigured: true,
    isOpenNow: open,
    timezone: timeZone,
    currentClosesAt: open
      ? currentClosesAt(intervals, now, timeZone, exceptions)
      : null,
    nextOpenAt: open ? null : nextOpenAt(intervals, now, timeZone, exceptions),
  };
}

/** Convenience: ISO day + minute helpers for tests. */
export function minuteOfDayFromHhMm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export type { IsoDayOfWeek, LocalCivilParts };
export { MINUTES_PER_DAY };
