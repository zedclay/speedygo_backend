import {
  ISO_DAYS_OF_WEEK,
  OPENING_HOURS_TIMEZONE,
} from './opening-hours.constants';
import {
  formatMinuteAsHhMm,
  normalizeIntervalTimes,
  parseHhMmToMinute,
  validateAndNormalizeWeeklySchedule,
  type OpeningDayInput,
} from './opening-hours.policy';
import {
  currentClosesAt,
  evaluateOpeningHours,
  isOpenAt,
  nextOpenAt,
} from './opening-hours.evaluator';
import { getLocalCivilParts, localCivilToUtc } from './opening-hours.timezone';
import { OpeningHoursError } from './opening-hours.errors';

function allDays(
  intervalsByDay: Partial<
    Record<number, Array<{ opens: string; closes: string }>>
  >,
): OpeningDayInput[] {
  return ISO_DAYS_OF_WEEK.map((dayOfWeek) => ({
    dayOfWeek,
    intervals: intervalsByDay[dayOfWeek] ?? [],
  }));
}

describe('opening-hours.policy', () => {
  it('parses strict HH:mm only', () => {
    expect(parseHhMmToMinute('09:00')).toBe(540);
    expect(parseHhMmToMinute('00:00')).toBe(0);
    expect(parseHhMmToMinute('23:59')).toBe(1439);
    expect(parseHhMmToMinute('9:00')).toBeNull();
    expect(parseHhMmToMinute('09:0')).toBeNull();
    expect(parseHhMmToMinute('09:00:00')).toBeNull();
    expect(parseHhMmToMinute('24:00')).toBeNull();
    expect(parseHhMmToMinute('12:60')).toBeNull();
  });

  it('formats minutes as HH:mm', () => {
    expect(formatMinuteAsHhMm(0)).toBe('00:00');
    expect(formatMinuteAsHhMm(540)).toBe('09:00');
    expect(formatMinuteAsHhMm(1439)).toBe('23:59');
  });

  it('normalizes same-day, overnight, and 24h', () => {
    expect(normalizeIntervalTimes(540, 1020)).toEqual({
      opensMinute: 540,
      closesMinute: 1020,
      closesNextDay: false,
    });
    expect(normalizeIntervalTimes(1320, 120)).toEqual({
      opensMinute: 1320,
      closesMinute: 120,
      closesNextDay: true,
    });
    expect(normalizeIntervalTimes(0, 0)).toEqual({
      opensMinute: 0,
      closesMinute: 0,
      closesNextDay: true,
    });
    expect(() => normalizeIntervalTimes(540, 540)).toThrow(OpeningHoursError);
  });

  it('requires exactly 7 unique days and accepts empty closed days', () => {
    const normalized = validateAndNormalizeWeeklySchedule(
      allDays({ 1: [{ opens: '09:00', closes: '17:00' }] }),
    );
    expect(normalized).toHaveLength(7);
    expect(normalized[0].intervals).toHaveLength(1);
    expect(normalized[1].intervals).toHaveLength(0);

    expect(() =>
      validateAndNormalizeWeeklySchedule([
        { dayOfWeek: 1, intervals: [] },
        { dayOfWeek: 2, intervals: [] },
      ]),
    ).toThrow(OpeningHoursError);

    expect(() =>
      validateAndNormalizeWeeklySchedule(
        allDays({ 1: [{ opens: '09:00', closes: '17:00' }] }).concat([
          { dayOfWeek: 1, intervals: [] },
        ] as never),
      ),
    ).toThrow(OpeningHoursError);
  });

  it('rejects overlaps but accepts adjacent half-open intervals', () => {
    expect(() =>
      validateAndNormalizeWeeklySchedule(
        allDays({
          1: [
            { opens: '09:00', closes: '12:00' },
            { opens: '11:00', closes: '14:00' },
          ],
        }),
      ),
    ).toThrow(OpeningHoursError);

    const adjacent = validateAndNormalizeWeeklySchedule(
      allDays({
        1: [
          { opens: '09:00', closes: '12:00' },
          { opens: '12:00', closes: '17:00' },
        ],
      }),
    );
    expect(adjacent[0].intervals).toHaveLength(2);

    expect(() =>
      validateAndNormalizeWeeklySchedule(
        allDays({
          1: [{ opens: '22:00', closes: '02:00' }],
          2: [{ opens: '01:00', closes: '05:00' }],
        }),
      ),
    ).toThrow(OpeningHoursError);
  });

  it('accepts overnight that does not overlap next-day morning', () => {
    const ok = validateAndNormalizeWeeklySchedule(
      allDays({
        1: [{ opens: '22:00', closes: '02:00' }],
        2: [{ opens: '02:00', closes: '05:00' }],
      }),
    );
    expect(ok[0].intervals[0].closesNextDay).toBe(true);
    expect(ok[1].intervals[0].opensMinute).toBe(120);
  });

  it('Sunday→Monday circular-week: overnight overlapping Monday morning is rejected', () => {
    // ISO: 7=Sunday, 1=Monday
    expect(() =>
      validateAndNormalizeWeeklySchedule(
        allDays({
          7: [{ opens: '22:00', closes: '02:00' }],
          1: [{ opens: '01:00', closes: '03:00' }],
        }),
      ),
    ).toThrow(OpeningHoursError);
  });

  it('Sunday→Monday circular-week: overnight adjacent to Monday morning is accepted', () => {
    const ok = validateAndNormalizeWeeklySchedule(
      allDays({
        7: [{ opens: '22:00', closes: '02:00' }],
        1: [{ opens: '02:00', closes: '05:00' }],
      }),
    );
    expect(ok[6].dayOfWeek).toBe(7);
    expect(ok[6].intervals[0].closesNextDay).toBe(true);
    expect(ok[0].dayOfWeek).toBe(1);
    expect(ok[0].intervals[0].opensMinute).toBe(120);
  });

  it('rejects more than 3 intervals per day', () => {
    expect(() =>
      validateAndNormalizeWeeklySchedule(
        allDays({
          1: [
            { opens: '08:00', closes: '09:00' },
            { opens: '10:00', closes: '11:00' },
            { opens: '12:00', closes: '13:00' },
            { opens: '14:00', closes: '15:00' },
          ],
        }),
      ),
    ).toThrow(OpeningHoursError);
  });
});

describe('opening-hours.timezone', () => {
  it('reads Africa/Algiers via Intl (not hardcoded UTC+1 alone)', () => {
    // 2024-01-15 10:00 UTC = 11:00 Africa/Algiers (CET UTC+1, no DST)
    const utc = new Date('2024-01-15T10:00:00.000Z');
    const parts = getLocalCivilParts(utc, OPENING_HOURS_TIMEZONE);
    expect(parts.hour).toBe(11);
    expect(parts.minute).toBe(0);
    expect(parts.dayOfWeek).toBe(1); // Monday

    const back = localCivilToUtc(
      { year: 2024, month: 1, day: 15, hour: 11, minute: 0 },
      OPENING_HOURS_TIMEZONE,
    );
    expect(back.toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('opening-hours.evaluator', () => {
  const mondayNineToFive = validateAndNormalizeWeeklySchedule(
    allDays({ 1: [{ opens: '09:00', closes: '17:00' }] }),
  ).flatMap((day) => day.intervals);

  const overnight = validateAndNormalizeWeeklySchedule(
    allDays({ 1: [{ opens: '22:00', closes: '02:00' }] }),
  ).flatMap((day) => day.intervals);

  const twentyFourSeven = validateAndNormalizeWeeklySchedule(
    allDays(
      Object.fromEntries(
        ISO_DAYS_OF_WEEK.map((d) => [d, [{ opens: '00:00', closes: '00:00' }]]),
      ),
    ),
  ).flatMap((day) => day.intervals);

  const adjacentContinuous = validateAndNormalizeWeeklySchedule(
    allDays({
      1: [
        { opens: '09:00', closes: '12:00' },
        { opens: '12:00', closes: '17:00' },
      ],
    }),
  ).flatMap((day) => day.intervals);

  it('half-open: exact open is open; exact close is closed', () => {
    // Mon 09:00 Algiers = 08:00 UTC
    const atOpen = new Date('2024-01-15T08:00:00.000Z');
    const atClose = new Date('2024-01-15T16:00:00.000Z');
    const before = new Date('2024-01-15T07:59:59.000Z');
    expect(isOpenAt(mondayNineToFive, atOpen)).toBe(true);
    expect(isOpenAt(mondayNineToFive, atClose)).toBe(false);
    expect(isOpenAt(mondayNineToFive, before)).toBe(false);
  });

  it('handles overnight intervals', () => {
    // Mon 23:00 Algiers = 22:00 UTC open
    expect(isOpenAt(overnight, new Date('2024-01-15T22:00:00.000Z'))).toBe(
      true,
    );
    // Tue 01:00 Algiers = 00:00 UTC still open from Mon overnight
    expect(isOpenAt(overnight, new Date('2024-01-16T00:00:00.000Z'))).toBe(
      true,
    );
    // Tue 02:00 Algiers = 01:00 UTC closed
    expect(isOpenAt(overnight, new Date('2024-01-16T01:00:00.000Z'))).toBe(
      false,
    );
  });

  it('handles 24h 00:00→00:00', () => {
    expect(
      isOpenAt(twentyFourSeven, new Date('2024-01-15T10:00:00.000Z')),
    ).toBe(true);
  });

  it('extends currentClosesAt through adjacent continuous intervals', () => {
    const midMorning = new Date('2024-01-15T09:00:00.000Z'); // 10:00 Algiers
    const closes = currentClosesAt(adjacentContinuous, midMorning);
    expect(closes?.toISOString()).toBe('2024-01-15T16:00:00.000Z'); // 17:00 Algiers
  });

  it('nextOpenAt is bounded and returns null when always closed', () => {
    const sunday = new Date('2024-01-14T10:00:00.000Z'); // Sun 11:00 Algiers
    const next = nextOpenAt(mondayNineToFive, sunday);
    expect(next?.toISOString()).toBe('2024-01-15T08:00:00.000Z');

    expect(nextOpenAt([], sunday)).toBeNull();
    expect(evaluateOpeningHours(null, sunday).hoursConfigured).toBe(false);
    expect(evaluateOpeningHours([], sunday).isOpenNow).toBe(false);
    expect(evaluateOpeningHours([], sunday).nextOpenAt).toBeNull();
  });

  it('evaluateOpeningHours sets nextOpenAt only when closed', () => {
    const openNow = new Date('2024-01-15T10:00:00.000Z');
    const openEval = evaluateOpeningHours(mondayNineToFive, openNow);
    expect(openEval.isOpenNow).toBe(true);
    expect(openEval.nextOpenAt).toBeNull();
    expect(openEval.currentClosesAt).not.toBeNull();

    const closed = new Date('2024-01-15T18:00:00.000Z');
    const closedEval = evaluateOpeningHours(mondayNineToFive, closed);
    expect(closedEval.isOpenNow).toBe(false);
    expect(closedEval.currentClosesAt).toBeNull();
    expect(closedEval.nextOpenAt).not.toBeNull();
  });
});
