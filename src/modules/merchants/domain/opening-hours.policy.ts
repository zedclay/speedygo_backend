import {
  ISO_DAYS_OF_WEEK,
  MINUTES_PER_DAY,
  OPENING_HOURS_MAX_INTERVALS_PER_DAY,
  OPENING_HOURS_MAX_TOTAL_INTERVALS,
  type IsoDayOfWeek,
} from './opening-hours.constants';
import { openingHoursInvalid } from './opening-hours.errors';
import { isoDayPlus } from './opening-hours.timezone';

export type OpeningIntervalInput = {
  opens: string;
  closes: string;
};

export type OpeningDayInput = {
  dayOfWeek: number;
  intervals: OpeningIntervalInput[];
};

export type NormalizedOpeningInterval = {
  dayOfWeek: IsoDayOfWeek;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  sortOrder: number;
};

export type NormalizedOpeningDay = {
  dayOfWeek: IsoDayOfWeek;
  intervals: NormalizedOpeningInterval[];
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Strict HH:mm (exactly two digits each). Rejects H:mm, HH:m, seconds, spaces. */
export function parseHhMmToMinute(value: string): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = HH_MM.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}

export function formatMinuteAsHhMm(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Derive closesNextDay + normalize a single interval.
 * 24h: 00:00→00:00 ⇒ closesNextDay true.
 * Overnight: closes ≤ opens (except 24h case handled) with closes < opens ⇒ overnight.
 */
export function normalizeIntervalTimes(
  opensMinute: number,
  closesMinute: number,
): { opensMinute: number; closesMinute: number; closesNextDay: boolean } {
  if (
    !Number.isInteger(opensMinute) ||
    !Number.isInteger(closesMinute) ||
    opensMinute < 0 ||
    opensMinute > 1439 ||
    closesMinute < 0 ||
    closesMinute > 1439
  ) {
    throw openingHoursInvalid('Interval minutes must be integers in 0..1439');
  }

  if (opensMinute === 0 && closesMinute === 0) {
    return { opensMinute: 0, closesMinute: 0, closesNextDay: true };
  }

  if (closesMinute > opensMinute) {
    return { opensMinute, closesMinute, closesNextDay: false };
  }

  if (closesMinute < opensMinute) {
    return { opensMinute, closesMinute, closesNextDay: true };
  }

  throw openingHoursInvalid(
    'Zero-duration same-day intervals are not allowed (use 00:00→00:00 for 24h)',
  );
}

type AbsoluteSpan = { start: number; end: number };

function intervalToAbsoluteSpans(
  interval: NormalizedOpeningInterval,
): AbsoluteSpan[] {
  const weekMinutes = 7 * MINUTES_PER_DAY;
  const start =
    (interval.dayOfWeek - 1) * MINUTES_PER_DAY + interval.opensMinute;
  let end: number;
  if (interval.closesNextDay) {
    end = interval.dayOfWeek * MINUTES_PER_DAY + interval.closesMinute;
    // dayOfWeek=7 → end may equal weekMinutes + closesMinute
    if (interval.dayOfWeek === 7) {
      end = weekMinutes + interval.closesMinute;
    }
  } else {
    end = (interval.dayOfWeek - 1) * MINUTES_PER_DAY + interval.closesMinute;
  }

  if (end <= start) {
    throw openingHoursInvalid('Interval duration must be positive');
  }
  if (interval.closesNextDay) {
    const duration =
      MINUTES_PER_DAY - interval.opensMinute + interval.closesMinute;
    if (duration <= 0 || duration > MINUTES_PER_DAY) {
      throw openingHoursInvalid(
        'Overnight interval duration must be 1..1440 minutes',
      );
    }
  }

  if (end <= weekMinutes) {
    return [{ start, end }];
  }
  // Wraps past Sunday → split into [start, week) and [0, end - week)
  return [
    { start, end: weekMinutes },
    { start: 0, end: end - weekMinutes },
  ];
}

/** Half-open overlap: [a,b) overlaps [c,d) iff a < d && c < b. Adjacent OK. */
function spansOverlap(a: AbsoluteSpan, b: AbsoluteSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function assertNoOverlaps(intervals: NormalizedOpeningInterval[]): void {
  const spans: AbsoluteSpan[] = [];
  for (const interval of intervals) {
    spans.push(...intervalToAbsoluteSpans(interval));
  }
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (spansOverlap(spans[i], spans[j])) {
        throw openingHoursInvalid(
          'Opening intervals overlap across the weekly schedule',
        );
      }
    }
  }
}

/**
 * Validate PUT payload: exactly 7 unique ISO days; empty day = closed;
 * normalize intervals; reject overlaps; accept adjacent non-overlapping.
 */
export function validateAndNormalizeWeeklySchedule(
  days: OpeningDayInput[],
): NormalizedOpeningDay[] {
  if (!Array.isArray(days) || days.length !== 7) {
    throw openingHoursInvalid('Schedule must include exactly 7 day entries');
  }

  const seen = new Set<number>();
  const normalizedDays: NormalizedOpeningDay[] = [];
  const allIntervals: NormalizedOpeningInterval[] = [];

  for (const day of days) {
    if (
      !Number.isInteger(day.dayOfWeek) ||
      day.dayOfWeek < 1 ||
      day.dayOfWeek > 7
    ) {
      throw openingHoursInvalid('dayOfWeek must be an integer 1..7 (ISO)');
    }
    if (seen.has(day.dayOfWeek)) {
      throw openingHoursInvalid('dayOfWeek values must be unique');
    }
    seen.add(day.dayOfWeek);

    if (!Array.isArray(day.intervals)) {
      throw openingHoursInvalid('Each day must include an intervals array');
    }
    if (day.intervals.length > OPENING_HOURS_MAX_INTERVALS_PER_DAY) {
      throw openingHoursInvalid(
        `At most ${OPENING_HOURS_MAX_INTERVALS_PER_DAY} intervals per day`,
      );
    }

    const dayIntervals: NormalizedOpeningInterval[] = [];
    for (let i = 0; i < day.intervals.length; i += 1) {
      const raw = day.intervals[i];
      const opensMinute = parseHhMmToMinute(raw.opens);
      const closesMinute = parseHhMmToMinute(raw.closes);
      if (opensMinute === null || closesMinute === null) {
        throw openingHoursInvalid(
          'Interval opens/closes must be strict HH:mm (00:00..23:59)',
        );
      }
      const times = normalizeIntervalTimes(opensMinute, closesMinute);
      dayIntervals.push({
        dayOfWeek: day.dayOfWeek as IsoDayOfWeek,
        opensMinute: times.opensMinute,
        closesMinute: times.closesMinute,
        closesNextDay: times.closesNextDay,
        sortOrder: i,
      });
    }

    // Same-day sort + adjacent OK; overlaps caught globally
    dayIntervals.sort((a, b) => a.opensMinute - b.opensMinute);
    dayIntervals.forEach((interval, index) => {
      interval.sortOrder = index;
    });

    normalizedDays.push({
      dayOfWeek: day.dayOfWeek as IsoDayOfWeek,
      intervals: dayIntervals,
    });
    allIntervals.push(...dayIntervals);
  }

  for (const iso of ISO_DAYS_OF_WEEK) {
    if (!seen.has(iso)) {
      throw openingHoursInvalid('Schedule must include every ISO weekday 1..7');
    }
  }

  if (allIntervals.length > OPENING_HOURS_MAX_TOTAL_INTERVALS) {
    throw openingHoursInvalid(
      `At most ${OPENING_HOURS_MAX_TOTAL_INTERVALS} intervals in a weekly schedule`,
    );
  }

  assertNoOverlaps(allIntervals);

  return normalizedDays.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

export function flattenNormalizedDays(
  days: NormalizedOpeningDay[],
): NormalizedOpeningInterval[] {
  return days.flatMap((day) => day.intervals);
}

/** Group stored intervals into exactly 7 days (missing day ⇒ empty). */
export function groupIntervalsByDay(
  intervals: ReadonlyArray<{
    dayOfWeek: number;
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
    sortOrder: number;
  }>,
): NormalizedOpeningDay[] {
  return ISO_DAYS_OF_WEEK.map((dayOfWeek) => ({
    dayOfWeek,
    intervals: intervals
      .filter((interval) => interval.dayOfWeek === dayOfWeek)
      .slice()
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.opensMinute - b.opensMinute,
      )
      .map((interval, index) => ({
        dayOfWeek,
        opensMinute: interval.opensMinute,
        closesMinute: interval.closesMinute,
        closesNextDay: interval.closesNextDay,
        sortOrder: index,
      })),
  }));
}

export { isoDayPlus };
