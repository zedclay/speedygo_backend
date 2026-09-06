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
  interval: NormalizedOpeningInterval,
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

function windowsAroundNow(
  intervals: readonly NormalizedOpeningInterval[],
  now: Date,
  timeZone: string,
): TimedWindow[] {
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
): boolean {
  if (intervals.length === 0) {
    return false;
  }
  const t = now.getTime();
  for (const window of windowsAroundNow(intervals, now, timeZone)) {
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
): Date | null {
  if (!isOpenAt(intervals, now, timeZone)) {
    return null;
  }
  const t = now.getTime();
  const windows = windowsAroundNow(intervals, now, timeZone);
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
): Date | null {
  if (intervals.length === 0) {
    return null;
  }
  const t = now.getTime();
  const bound = t + 7 * 24 * 60 * 60 * 1000;
  for (const window of windowsAroundNow(intervals, now, timeZone)) {
    if (window.opensAt.getTime() > t && window.opensAt.getTime() <= bound) {
      return window.opensAt;
    }
  }
  return null;
}

export function evaluateOpeningHours(
  intervals: readonly NormalizedOpeningInterval[] | null | undefined,
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
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
  const open = isOpenAt(intervals, now, timeZone);
  return {
    hoursConfigured: true,
    isOpenNow: open,
    timezone: timeZone,
    currentClosesAt: open ? currentClosesAt(intervals, now, timeZone) : null,
    nextOpenAt: open ? null : nextOpenAt(intervals, now, timeZone),
  };
}

/** Convenience: ISO day + minute helpers for tests. */
export function minuteOfDayFromHhMm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export type { IsoDayOfWeek, LocalCivilParts };
export { MINUTES_PER_DAY };
