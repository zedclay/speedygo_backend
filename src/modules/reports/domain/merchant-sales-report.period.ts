import {
  getLocalCivilParts,
  localCivilToUtc,
} from '../../merchants/domain/opening-hours.timezone';

/** Merchant-facing reports use the Algerian business day (not UTC instants). */
export const MERCHANT_REPORT_TIMEZONE = 'Africa/Algiers';

export const MERCHANT_REPORT_PERIODS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'CUSTOM',
] as const;
export type MerchantReportPeriod = (typeof MERCHANT_REPORT_PERIODS)[number];

export const MERCHANT_REPORT_MAX_CUSTOM_DAYS = 93;

export type MerchantReportGranularity = 'HOUR' | 'DAY';

export type MerchantReportBucket = {
  /** Local key matching the SQL grouping (`YYYY-MM-DD` or `YYYY-MM-DDTHH`). */
  key: string;
  /** UTC instant of the bucket start. */
  start: Date;
  /** Local wall-clock start (`YYYY-MM-DD` or `YYYY-MM-DDTHH:00`). */
  localStart: string;
};

export type ResolvedMerchantReportPeriod = {
  period: MerchantReportPeriod;
  timezone: typeof MERCHANT_REPORT_TIMEZONE;
  /** Inclusive UTC start of the half-open window. */
  from: Date;
  /** Exclusive UTC end of the half-open window. */
  to: Date;
  localFrom: string;
  localToInclusive: string;
  granularity: MerchantReportGranularity;
  /** Ascending buckets; buckets starting after `asOf` are omitted. */
  buckets: MerchantReportBucket[];
  asOf: Date;
};

type CivilDate = { year: number; month: number; day: number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function formatCivilDate(date: CivilDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** Calendar arithmetic on civil dates (no timezone involved). */
function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  return (
    Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)
  );
}

function daysBetweenInclusive(from: CivilDate, to: CivilDate): number {
  return Math.round(compareCivil(to, from) / DAY_MS) + 1;
}

export function parseCivilDate(raw: string | undefined): CivilDate | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const match = ISO_DATE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() + 1 !== date.month ||
    check.getUTCDate() !== date.day
  ) {
    return null;
  }
  return date;
}

function localMidnightUtc(date: CivilDate): Date {
  return localCivilToUtc(
    { ...date, hour: 0, minute: 0 },
    MERCHANT_REPORT_TIMEZONE,
  );
}

export class MerchantReportPeriodError extends Error {}

/**
 * Resolve a Merchant report period to a half-open `[from, to)` UTC window
 * whose boundaries are local midnights in Africa/Algiers.
 *
 * - TODAY / YESTERDAY: one local day, hourly buckets.
 * - THIS_WEEK: ISO week (Monday 00:00 → next Monday 00:00), daily buckets.
 * - THIS_MONTH: calendar month (1st 00:00 → 1st of next month 00:00), daily buckets.
 * - CUSTOM: inclusive local dates `from`..`to` (max 93 days, not after today);
 *   hourly buckets for a single day, otherwise daily.
 */
export function resolveMerchantReportPeriod(input: {
  period: MerchantReportPeriod;
  now: Date;
  from?: string;
  to?: string;
}): ResolvedMerchantReportPeriod {
  const local = getLocalCivilParts(input.now, MERCHANT_REPORT_TIMEZONE);
  const today: CivilDate = {
    year: local.year,
    month: local.month,
    day: local.day,
  };

  if (
    input.period !== 'CUSTOM' &&
    (input.from !== undefined || input.to !== undefined)
  ) {
    throw new MerchantReportPeriodError(
      'from and to are only accepted with period=CUSTOM',
    );
  }

  let first: CivilDate;
  let last: CivilDate;
  switch (input.period) {
    case 'TODAY':
      first = today;
      last = today;
      break;
    case 'YESTERDAY':
      first = addDays(today, -1);
      last = first;
      break;
    case 'THIS_WEEK':
      first = addDays(today, 1 - local.dayOfWeek);
      last = addDays(first, 6);
      break;
    case 'THIS_MONTH': {
      first = { year: today.year, month: today.month, day: 1 };
      const nextMonthFirst =
        today.month === 12
          ? { year: today.year + 1, month: 1, day: 1 }
          : { year: today.year, month: today.month + 1, day: 1 };
      last = addDays(nextMonthFirst, -1);
      break;
    }
    case 'CUSTOM': {
      const from = parseCivilDate(input.from);
      const to = parseCivilDate(input.to);
      if (!from || !to) {
        throw new MerchantReportPeriodError(
          'CUSTOM period requires from and to as YYYY-MM-DD local dates',
        );
      }
      if (compareCivil(from, to) > 0) {
        throw new MerchantReportPeriodError('from must not be after to');
      }
      if (compareCivil(to, today) > 0) {
        throw new MerchantReportPeriodError(
          'to must not be after today (Africa/Algiers)',
        );
      }
      if (daysBetweenInclusive(from, to) > MERCHANT_REPORT_MAX_CUSTOM_DAYS) {
        throw new MerchantReportPeriodError(
          `CUSTOM period must not exceed ${MERCHANT_REPORT_MAX_CUSTOM_DAYS} days`,
        );
      }
      first = from;
      last = to;
      break;
    }
    default:
      throw new MerchantReportPeriodError('Unknown period');
  }

  const fromInstant = localMidnightUtc(first);
  const toInstant = localMidnightUtc(addDays(last, 1));
  const granularity: MerchantReportGranularity =
    compareCivil(first, last) === 0 ? 'HOUR' : 'DAY';

  const buckets: MerchantReportBucket[] = [];
  if (granularity === 'HOUR') {
    const date = formatCivilDate(first);
    for (let hour = 0; hour < 24; hour += 1) {
      const start = localCivilToUtc(
        { ...first, hour, minute: 0 },
        MERCHANT_REPORT_TIMEZONE,
      );
      if (start.getTime() > input.now.getTime()) {
        break;
      }
      buckets.push({
        key: `${date}T${pad(hour)}`,
        start,
        localStart: `${date}T${pad(hour)}:00`,
      });
    }
  } else {
    for (let day = first; compareCivil(day, last) <= 0; day = addDays(day, 1)) {
      const start = localMidnightUtc(day);
      if (start.getTime() > input.now.getTime()) {
        break;
      }
      const key = formatCivilDate(day);
      buckets.push({ key, start, localStart: key });
    }
  }

  return {
    period: input.period,
    timezone: MERCHANT_REPORT_TIMEZONE,
    from: fromInstant,
    to: toInstant,
    localFrom: formatCivilDate(first),
    localToInclusive: formatCivilDate(last),
    granularity,
    buckets,
    asOf: input.now,
  };
}
