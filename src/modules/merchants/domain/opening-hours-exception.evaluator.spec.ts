import { evaluateEffectiveAvailability } from './branch-availability.evaluator';
import { ISO_DAYS_OF_WEEK } from './opening-hours.constants';
import {
  currentClosesAt,
  evaluateOpeningHours,
  isOpenAt,
  nextOpenAt,
  type OpeningHoursExceptionDay,
} from './opening-hours.evaluator';
import {
  captureOpenNowLocalParts,
  openNowAtLocalWithExceptions,
} from './opening-hours.open-now-filter';
import {
  normalizeIntervalTimes,
  type NormalizedOpeningInterval,
} from './opening-hours.policy';

// Africa/Algiers is UTC+1 all year (no DST). 2024-01-15 is a Monday.
const at = (iso: string) => new Date(iso);

function weekly(
  dayOfWeek: number,
  opens: string,
  closes: string,
): NormalizedOpeningInterval {
  const [oh, om] = opens.split(':').map(Number);
  const [ch, cm] = closes.split(':').map(Number);
  const times = normalizeIntervalTimes(oh * 60 + om, ch * 60 + cm);
  return {
    dayOfWeek: dayOfWeek as NormalizedOpeningInterval['dayOfWeek'],
    ...times,
    sortOrder: 0,
  };
}

function exception(
  localDate: string,
  closed: boolean,
  intervals: Array<[string, string]> = [],
): OpeningHoursExceptionDay {
  return {
    localDate,
    closed,
    intervals: intervals.map(([opens, closes]) => {
      const [oh, om] = opens.split(':').map(Number);
      const [ch, cm] = closes.split(':').map(Number);
      const closesMinute = ch * 60 + cm;
      return {
        opensMinute: oh * 60 + om,
        closesMinute,
        closesNextDay: closesMinute === 0,
      };
    }),
  };
}

const nineToFiveAllWeek = ISO_DAYS_OF_WEEK.map((d) =>
  weekly(d, '09:00', '17:00'),
);
const allDay = ISO_DAYS_OF_WEEK.map((d) => weekly(d, '00:00', '00:00'));

describe('opening hours evaluation with date exceptions', () => {
  it('is identical to the weekly evaluation when no exception exists', () => {
    const samples = [
      '2024-01-15T07:59:00Z',
      '2024-01-15T08:00:00Z',
      '2024-01-15T15:59:00Z',
      '2024-01-15T16:00:00Z',
      '2024-01-15T23:30:00Z',
      '2024-01-20T12:00:00Z',
    ];
    for (const iso of samples) {
      const now = at(iso);
      expect(
        evaluateOpeningHours(nineToFiveAllWeek, now, undefined, []),
      ).toEqual(evaluateOpeningHours(nineToFiveAllWeek, now));
    }
    // An exception on an unrelated far date does not change today.
    const far = [exception('2024-03-01', true)];
    expect(
      evaluateOpeningHours(
        nineToFiveAllWeek,
        at('2024-01-15T10:00:00Z'),
        undefined,
        far,
      ),
    ).toEqual(
      evaluateOpeningHours(nineToFiveAllWeek, at('2024-01-15T10:00:00Z')),
    );
  });

  it('a closed date blocks the whole civil day and nextOpenAt skips to the weekly schedule', () => {
    const closedMonday = [exception('2024-01-15', true)];
    const noon = at('2024-01-15T11:00:00Z'); // Mon 12:00 local
    const ev = evaluateOpeningHours(
      nineToFiveAllWeek,
      noon,
      undefined,
      closedMonday,
    );
    expect(ev.hoursConfigured).toBe(true);
    expect(ev.isOpenNow).toBe(false);
    expect(ev.nextOpenAt?.toISOString()).toBe('2024-01-16T08:00:00.000Z'); // Tue 09:00
  });

  it('a custom interval replaces the weekly schedule; half-open boundaries', () => {
    const shortMonday = [exception('2024-01-15', false, [['10:00', '13:00']])];
    const tz = undefined;
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T08:30:00Z'), tz, shortMonday),
    ).toBe(false); // 09:30 weekly-open, exception not yet
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T09:00:00Z'), tz, shortMonday),
    ).toBe(true); // 10:00 exact open
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T11:59:00Z'), tz, shortMonday),
    ).toBe(true); // 12:59
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T12:00:00Z'), tz, shortMonday),
    ).toBe(false); // 13:00 exact close
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T14:00:00Z'), tz, shortMonday),
    ).toBe(false); // 15:00 weekly-open, exception closed
    expect(
      currentClosesAt(
        nineToFiveAllWeek,
        at('2024-01-15T10:00:00Z'),
        tz,
        shortMonday,
      )?.toISOString(),
    ).toBe('2024-01-15T12:00:00.000Z');
    expect(
      nextOpenAt(
        nineToFiveAllWeek,
        at('2024-01-15T07:00:00Z'),
        tz,
        shortMonday,
      )?.toISOString(),
    ).toBe('2024-01-15T09:00:00.000Z');
  });

  it('dates without an exception fall back to weekly hours', () => {
    const tuesdayClosed = [exception('2024-01-16', true)];
    expect(
      isOpenAt(
        nineToFiveAllWeek,
        at('2024-01-15T10:00:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(true);
    expect(
      isOpenAt(
        nineToFiveAllWeek,
        at('2024-01-17T10:00:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(true);
    expect(
      isOpenAt(
        nineToFiveAllWeek,
        at('2024-01-16T10:00:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(false);
  });

  it('cuts weekly overnight spill at midnight when the next date has an exception', () => {
    const lateMonday = [weekly(1, '22:00', '02:00')];
    const tuesdayClosed = [exception('2024-01-16', true)];
    // Mon 23:00 local: open, closes at Tue 00:00 local (= Mon 23:00Z).
    expect(
      isOpenAt(
        lateMonday,
        at('2024-01-15T22:00:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(true);
    expect(
      currentClosesAt(
        lateMonday,
        at('2024-01-15T22:00:00Z'),
        undefined,
        tuesdayClosed,
      )?.toISOString(),
    ).toBe('2024-01-15T23:00:00.000Z');
    // Tue 00:00 local exactly and 00:30 local: closed (would be open without the exception).
    expect(
      isOpenAt(
        lateMonday,
        at('2024-01-15T23:00:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(false);
    expect(isOpenAt(lateMonday, at('2024-01-15T23:30:00Z'))).toBe(true);
    expect(
      isOpenAt(
        lateMonday,
        at('2024-01-15T23:30:00Z'),
        undefined,
        tuesdayClosed,
      ),
    ).toBe(false);
  });

  it('an exception date never spills into the next date', () => {
    const lateMonday = [weekly(1, '22:00', '02:00')];
    const mondayShort = [exception('2024-01-15', false, [['09:00', '13:00']])];
    // Tue 01:00 local: Monday's weekly overnight is replaced by the exception.
    expect(isOpenAt(lateMonday, at('2024-01-16T00:00:00Z'))).toBe(true);
    expect(
      isOpenAt(lateMonday, at('2024-01-16T00:00:00Z'), undefined, mondayShort),
    ).toBe(false);
  });

  it('closes=00:00 means until midnight and joins an adjacent all-day weekly date', () => {
    const until = [exception('2024-01-15', false, [['18:00', '00:00']])];
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T22:59:00Z'), undefined, until),
    ).toBe(true); // 23:59
    expect(
      isOpenAt(nineToFiveAllWeek, at('2024-01-15T23:00:00Z'), undefined, until),
    ).toBe(false); // Tue 00:00
    expect(
      currentClosesAt(
        nineToFiveAllWeek,
        at('2024-01-15T20:00:00Z'),
        undefined,
        until,
      )?.toISOString(),
    ).toBe('2024-01-15T23:00:00.000Z');
    // Next date is weekly 24h, so the open stretch continues through midnight
    // to the same scan bound the weekly-only evaluation reports.
    const joined = currentClosesAt(
      allDay,
      at('2024-01-15T20:00:00Z'),
      undefined,
      until,
    );
    expect(joined!.getTime()).toBeGreaterThan(
      at('2024-01-16T23:00:00Z').getTime(),
    );
    expect(joined?.toISOString()).toBe(
      currentClosesAt(allDay, at('2024-01-15T20:00:00Z'))?.toISOString(),
    );
  });

  it('00:00→00:00 opens the whole date even when the weekly day is closed', () => {
    const sundayOnlyWeekly = [weekly(7, '09:00', '17:00')];
    const mondayAllDay = [exception('2024-01-15', false, [['00:00', '00:00']])];
    expect(isOpenAt(sundayOnlyWeekly, at('2024-01-15T03:00:00Z'))).toBe(false);
    expect(
      isOpenAt(
        sundayOnlyWeekly,
        at('2024-01-15T03:00:00Z'),
        undefined,
        mondayAllDay,
      ),
    ).toBe(true);
    // Weekly configured but every day empty: an open exception still opens.
    expect(
      isOpenAt([], at('2024-01-15T03:00:00Z'), undefined, mondayAllDay),
    ).toBe(true);
    expect(
      nextOpenAt(
        [],
        at('2024-01-14T03:00:00Z'),
        undefined,
        mondayAllDay,
      )?.toISOString(),
    ).toBe('2024-01-14T23:00:00.000Z');
  });

  it('maps the Algiers civil date, not the UTC date', () => {
    // 2024-01-15T23:30Z is Tue 2024-01-16 00:30 in Algiers.
    const tuesdayClosed = [exception('2024-01-16', true)];
    expect(
      isOpenAt(allDay, at('2024-01-15T22:30:00Z'), undefined, tuesdayClosed),
    ).toBe(true); // Mon 23:30 local
    expect(
      isOpenAt(allDay, at('2024-01-15T23:30:00Z'), undefined, tuesdayClosed),
    ).toBe(false); // Tue 00:30 local
    expect(
      isOpenAt(allDay, at('2024-01-16T22:59:00Z'), undefined, tuesdayClosed),
    ).toBe(false); // Tue 23:59 local
    expect(
      isOpenAt(allDay, at('2024-01-16T23:00:00Z'), undefined, tuesdayClosed),
    ).toBe(true); // Wed 00:00 local
  });

  it('missing weekly schedule stays not configured even with an open exception', () => {
    const ev = evaluateOpeningHours(
      null,
      at('2024-01-15T10:00:00Z'),
      undefined,
      [exception('2024-01-15', false, [['00:00', '00:00']])],
    );
    expect(ev).toMatchObject({
      hoursConfigured: false,
      isOpenNow: false,
      nextOpenAt: null,
    });
  });

  describe('availability override precedence', () => {
    const openMonday = [exception('2024-01-15', false, [['00:00', '00:00']])];
    const closedMonday = [exception('2024-01-15', true)];
    const noon = at('2024-01-15T11:00:00Z');
    const base = {
      reasonCode: null,
      customerMessage: null,
      version: 1,
      updatedAt: noon.toISOString(),
    };

    it('FORCE_CLOSED wins over an open exception', () => {
      const ev = evaluateEffectiveAvailability(
        nineToFiveAllWeek,
        { ...base, mode: 'FORCE_CLOSED', closedUntil: null },
        noon,
        undefined,
        openMonday,
      );
      expect(ev.acceptingOrders).toBe(false);
      expect(ev.nextOpenAt).toBeNull();
    });

    it('active TEMPORARY_CLOSED wins; nextOpenAt honours the exception after closedUntil', () => {
      const closedUntil = at('2024-01-15T12:00:00Z'); // Mon 13:00
      const shortMonday = [
        exception('2024-01-15', false, [['15:00', '16:00']]),
      ];
      const ev = evaluateEffectiveAvailability(
        nineToFiveAllWeek,
        { ...base, mode: 'TEMPORARY_CLOSED', closedUntil },
        noon,
        undefined,
        shortMonday,
      );
      expect(ev.acceptingOrders).toBe(false);
      expect(ev.nextOpenAt?.toISOString()).toBe('2024-01-15T14:00:00.000Z'); // Mon 15:00
    });

    it('expired TEMPORARY_CLOSED falls back to the exception, then weekly', () => {
      const ev = evaluateEffectiveAvailability(
        nineToFiveAllWeek,
        {
          ...base,
          mode: 'TEMPORARY_CLOSED',
          closedUntil: at('2024-01-15T10:00:00Z'),
        },
        noon,
        undefined,
        closedMonday,
      );
      expect(ev.temporaryExpired).toBe(true);
      expect(ev.acceptingOrders).toBe(false);
      const weeklyOnly = evaluateEffectiveAvailability(
        nineToFiveAllWeek,
        { ...base, mode: 'FOLLOW_SCHEDULE', closedUntil: null },
        noon,
      );
      expect(weeklyOnly.acceptingOrders).toBe(true);
    });

    it('FOLLOW_SCHEDULE + open exception accepts orders outside weekly hours', () => {
      const ev = evaluateEffectiveAvailability(
        nineToFiveAllWeek,
        { ...base, mode: 'FOLLOW_SCHEDULE', closedUntil: null },
        at('2024-01-15T20:00:00Z'), // Mon 21:00
        undefined,
        openMonday,
      );
      expect(ev.acceptingOrders).toBe(true);
    });
  });

  describe('SQL openNow mirror stays aligned with isOpenAt', () => {
    const cases: Array<{
      name: string;
      now: string;
      weekly: NormalizedOpeningInterval[];
      exceptions: OpeningHoursExceptionDay[];
    }> = [
      {
        name: 'closed today',
        now: '2024-01-15T11:00:00Z',
        weekly: nineToFiveAllWeek,
        exceptions: [exception('2024-01-15', true)],
      },
      {
        name: 'custom inside',
        now: '2024-01-15T09:30:00Z',
        weekly: nineToFiveAllWeek,
        exceptions: [exception('2024-01-15', false, [['10:00', '13:00']])],
      },
      {
        name: 'custom exact close',
        now: '2024-01-15T12:00:00Z',
        weekly: nineToFiveAllWeek,
        exceptions: [exception('2024-01-15', false, [['10:00', '13:00']])],
      },
      {
        name: 'custom outside, weekly open',
        now: '2024-01-15T14:00:00Z',
        weekly: nineToFiveAllWeek,
        exceptions: [exception('2024-01-15', false, [['10:00', '13:00']])],
      },
      {
        name: 'spill blocked by previous exception',
        now: '2024-01-16T00:00:00Z',
        weekly: [weekly(1, '22:00', '02:00')],
        exceptions: [exception('2024-01-15', false, [['09:00', '13:00']])],
      },
      {
        name: 'spill blocked by today exception',
        now: '2024-01-15T23:30:00Z',
        weekly: [weekly(1, '22:00', '02:00')],
        exceptions: [exception('2024-01-16', true)],
      },
      {
        name: 'spill allowed without exceptions',
        now: '2024-01-15T23:30:00Z',
        weekly: [weekly(1, '22:00', '02:00')],
        exceptions: [exception('2024-01-20', true)],
      },
      {
        name: 'until midnight at 23:59',
        now: '2024-01-15T22:59:00Z',
        weekly: nineToFiveAllWeek,
        exceptions: [exception('2024-01-15', false, [['18:00', '00:00']])],
      },
      {
        name: 'all day on weekly-closed day',
        now: '2024-01-15T03:00:00Z',
        weekly: [weekly(7, '09:00', '17:00')],
        exceptions: [exception('2024-01-15', false, [['00:00', '00:00']])],
      },
    ];
    for (const entry of cases) {
      it(entry.name, () => {
        const now = at(entry.now);
        const local = captureOpenNowLocalParts(now);
        expect(
          openNowAtLocalWithExceptions(entry.weekly, entry.exceptions, local),
        ).toBe(isOpenAt(entry.weekly, now, undefined, entry.exceptions));
      });
    }

    it('captures Algiers civil dates for the SQL parameters', () => {
      expect(
        captureOpenNowLocalParts(at('2024-01-15T23:30:00Z')),
      ).toMatchObject({
        localDate: '2024-01-16',
        previousLocalDate: '2024-01-15',
        dayOfWeek: 2,
        previousDayOfWeek: 1,
        minuteOfDay: 30,
      });
      expect(
        captureOpenNowLocalParts(at('2024-03-01T10:00:00Z')),
      ).toMatchObject({
        localDate: '2024-03-01',
        previousLocalDate: '2024-02-29',
      });
    });
  });
});
