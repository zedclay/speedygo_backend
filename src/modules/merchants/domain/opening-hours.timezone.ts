import {
  ISO_DAYS_OF_WEEK,
  MINUTES_PER_DAY,
  OPENING_HOURS_TIMEZONE,
  type IsoDayOfWeek,
} from './opening-hours.constants';

export type LocalCivilParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO 1=Mon .. 7=Sun */
  dayOfWeek: IsoDayOfWeek;
  minuteOfDay: number;
};

const WEEKDAY_TO_ISO: Record<string, IsoDayOfWeek> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function readParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const out: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      out[part.type] = part.value;
    }
  }
  return out;
}

/**
 * Read civil calendar / clock fields for an instant in an IANA zone via Intl.
 * Africa/Algiers must be resolved through Intl — never hardcode UTC+1 alone.
 */
export function getLocalCivilParts(
  instant: Date,
  timeZone: string = OPENING_HOURS_TIMEZONE,
): LocalCivilParts {
  const parts = readParts(instant, timeZone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const weekday = parts.weekday;
  const dayOfWeek = WEEKDAY_TO_ISO[weekday];
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    dayOfWeek === undefined
  ) {
    throw new Error(`Unable to resolve local civil parts for ${timeZone}`);
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * Convert a civil local wall time in `timeZone` to a UTC Date.
 * Uses Intl offset probing (not a fixed UTC+1 formula).
 */
export function localCivilToUtc(
  input: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string = OPENING_HOURS_TIMEZONE,
): Date {
  const second = input.second ?? 0;
  // Initial guess: interpret civil fields as UTC, then correct by observed offset.
  let utcMillis = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    second,
  );

  for (let i = 0; i < 3; i += 1) {
    const asLocal = getLocalCivilParts(new Date(utcMillis), timeZone);
    const desiredAsMinutes =
      (((input.year * 12 + input.month) * 31 + input.day) * MINUTES_PER_DAY +
        input.hour * 60 +
        input.minute) *
        60 +
      second;
    const actualAsMinutes =
      (((asLocal.year * 12 + asLocal.month) * 31 + asLocal.day) *
        MINUTES_PER_DAY +
        asLocal.hour * 60 +
        asLocal.minute) *
        60 +
      asLocal.second;
    const deltaSeconds = desiredAsMinutes - actualAsMinutes;
    if (deltaSeconds === 0) {
      return new Date(utcMillis);
    }
    utcMillis += deltaSeconds * 1000;
  }

  const verified = getLocalCivilParts(new Date(utcMillis), timeZone);
  if (
    verified.year !== input.year ||
    verified.month !== input.month ||
    verified.day !== input.day ||
    verified.hour !== input.hour ||
    verified.minute !== input.minute ||
    verified.second !== second
  ) {
    throw new Error(
      `Unable to map civil time ${input.year}-${input.month}-${input.day} ${input.hour}:${input.minute} in ${timeZone}`,
    );
  }
  return new Date(utcMillis);
}

/** Add calendar days in the local zone and return the UTC instant of that civil date at given minute-of-day. */
export function localDatePlusDaysAtMinute(
  base: LocalCivilParts,
  dayOffset: number,
  minuteOfDay: number,
  timeZone: string = OPENING_HOURS_TIMEZONE,
): Date {
  const utcNoonGuess = localCivilToUtc(
    {
      year: base.year,
      month: base.month,
      day: base.day,
      hour: 12,
      minute: 0,
    },
    timeZone,
  );
  const shifted = new Date(
    utcNoonGuess.getTime() + dayOffset * 24 * 60 * 60 * 1000,
  );
  const shiftedParts = getLocalCivilParts(shifted, timeZone);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return localCivilToUtc(
    {
      year: shiftedParts.year,
      month: shiftedParts.month,
      day: shiftedParts.day,
      hour,
      minute,
    },
    timeZone,
  );
}

export function isoDayPlus(day: IsoDayOfWeek, delta: number): IsoDayOfWeek {
  const raw = (((day - 1 + delta) % 7) + 7) % 7;
  return ISO_DAYS_OF_WEEK[raw];
}
