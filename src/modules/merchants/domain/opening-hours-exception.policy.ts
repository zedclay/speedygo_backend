import {
  MINUTES_PER_DAY,
  OPENING_HOURS_MAX_INTERVALS_PER_DAY,
  OPENING_HOURS_TIMEZONE,
} from './opening-hours.constants';
import { openingHoursExceptionInvalid } from './opening-hours-exception.errors';
import { parseHhMmToMinute } from './opening-hours.policy';
import {
  getLocalCivilParts,
  localDatePlusDaysAtMinute,
  type LocalCivilParts,
} from './opening-hours.timezone';

export const OPENING_HOURS_EXCEPTION_MAX_DAYS_AHEAD = 365;
export const OPENING_HOURS_EXCEPTION_MAX_UPCOMING = 100;
export const OPENING_HOURS_EXCEPTION_LABEL_MAX = 80;
export const OPENING_HOURS_EXCEPTION_MESSAGE_MAX = 500;

/** Same-day interval: closesNextDay only for "until midnight" (closesMinute 0). */
export type NormalizedExceptionInterval = {
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  sortOrder: number;
};

export type NormalizedOpeningHoursException = {
  localDate: string;
  closed: boolean;
  intervals: NormalizedExceptionInterval[];
  label: string;
  customerMessage: string | null;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function civilDateKey(
  parts: Pick<LocalCivilParts, 'year' | 'month' | 'day'>,
): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Civil date (YYYY-MM-DD) of `now` plus `dayOffset` days in the opening-hours zone. */
export function localDateKeyPlusDays(
  now: Date,
  dayOffset: number,
  timeZone: string = OPENING_HOURS_TIMEZONE,
): string {
  const local = getLocalCivilParts(now, timeZone);
  if (dayOffset === 0) {
    return civilDateKey(local);
  }
  const noon = localDatePlusDaysAtMinute(local, dayOffset, 12 * 60, timeZone);
  return civilDateKey(getLocalCivilParts(noon, timeZone));
}

export function isStrictCivilDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Validate one exception write. Exception intervals stay inside their civil date:
 * `opens < closes`, or `closes = 00:00` meaning midnight; `00:00 → 00:00` is all day.
 */
export function validateAndNormalizeException(
  input: {
    date: unknown;
    closed: unknown;
    intervals: unknown;
    label: unknown;
    customerMessage?: unknown;
  },
  now: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
): NormalizedOpeningHoursException {
  if (!isStrictCivilDate(input.date)) {
    throw openingHoursExceptionInvalid('date must be a real YYYY-MM-DD date');
  }
  const today = localDateKeyPlusDays(now, 0, timeZone);
  const last = localDateKeyPlusDays(
    now,
    OPENING_HOURS_EXCEPTION_MAX_DAYS_AHEAD,
    timeZone,
  );
  if (input.date < today) {
    throw openingHoursExceptionInvalid('date must not be in the past');
  }
  if (input.date > last) {
    throw openingHoursExceptionInvalid(
      `date must be within ${OPENING_HOURS_EXCEPTION_MAX_DAYS_AHEAD} days`,
    );
  }
  if (typeof input.closed !== 'boolean') {
    throw openingHoursExceptionInvalid('closed must be a boolean');
  }
  if (!Array.isArray(input.intervals)) {
    throw openingHoursExceptionInvalid('intervals must be an array');
  }

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label.length < 1 || label.length > OPENING_HOURS_EXCEPTION_LABEL_MAX) {
    throw openingHoursExceptionInvalid(
      `label is required (1..${OPENING_HOURS_EXCEPTION_LABEL_MAX} characters)`,
    );
  }
  let customerMessage: string | null = null;
  if (input.customerMessage !== undefined && input.customerMessage !== null) {
    if (typeof input.customerMessage !== 'string') {
      throw openingHoursExceptionInvalid('customerMessage must be a string');
    }
    const trimmed = input.customerMessage.trim();
    if (trimmed.length > OPENING_HOURS_EXCEPTION_MESSAGE_MAX) {
      throw openingHoursExceptionInvalid(
        `customerMessage must be at most ${OPENING_HOURS_EXCEPTION_MESSAGE_MAX} characters`,
      );
    }
    customerMessage = trimmed.length > 0 ? trimmed : null;
  }

  if (input.closed) {
    if (input.intervals.length !== 0) {
      throw openingHoursExceptionInvalid(
        'A closed exception must not include intervals',
      );
    }
    return {
      localDate: input.date,
      closed: true,
      intervals: [],
      label,
      customerMessage,
    };
  }

  if (
    input.intervals.length < 1 ||
    input.intervals.length > OPENING_HOURS_MAX_INTERVALS_PER_DAY
  ) {
    throw openingHoursExceptionInvalid(
      `An open exception needs 1..${OPENING_HOURS_MAX_INTERVALS_PER_DAY} intervals`,
    );
  }

  const spans: Array<{ start: number; end: number }> = [];
  const intervals: NormalizedExceptionInterval[] = [];
  for (const raw of input.intervals as unknown[]) {
    const item = (raw ?? {}) as { opens?: unknown; closes?: unknown };
    const opensMinute = parseHhMmToMinute(item.opens as string);
    const closesMinute = parseHhMmToMinute(item.closes as string);
    if (opensMinute === null || closesMinute === null) {
      throw openingHoursExceptionInvalid(
        'Interval opens/closes must be strict HH:mm (00:00..23:59)',
      );
    }
    let end: number;
    let closesNextDay: boolean;
    if (closesMinute === 0) {
      end = MINUTES_PER_DAY;
      closesNextDay = true;
    } else if (closesMinute > opensMinute) {
      end = closesMinute;
      closesNextDay = false;
    } else {
      throw openingHoursExceptionInvalid(
        closesMinute === opensMinute
          ? 'Zero-duration intervals are not allowed'
          : 'Overnight exception intervals are not supported; end at 00:00 and add the next date',
      );
    }
    spans.push({ start: opensMinute, end });
    intervals.push({ opensMinute, closesMinute, closesNextDay, sortOrder: 0 });
  }

  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (spans[i].start < spans[j].end && spans[j].start < spans[i].end) {
        throw openingHoursExceptionInvalid('Exception intervals overlap');
      }
    }
  }

  intervals.sort((a, b) => a.opensMinute - b.opensMinute);
  intervals.forEach((interval, index) => {
    interval.sortOrder = index;
  });

  return {
    localDate: input.date,
    closed: false,
    intervals,
    label,
    customerMessage,
  };
}
