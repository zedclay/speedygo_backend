import {
  isStrictCivilDate,
  localDateKeyPlusDays,
  validateAndNormalizeException,
} from './opening-hours-exception.policy';

// 2026-10-02T10:00Z = Friday 11:00 Africa/Algiers.
const now = new Date('2026-10-02T10:00:00Z');

function base(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-10-05',
    closed: false,
    intervals: [{ opens: '09:00', closes: '13:00' }],
    label: 'Jour férié',
    ...overrides,
  };
}

function expectInvalid(input: Record<string, unknown>) {
  expect(() => validateAndNormalizeException(base(input), now)).toThrow(
    expect.objectContaining({
      code: 'OPENING_HOURS_EXCEPTION_INVALID',
      httpStatus: 400,
    }),
  );
}

describe('opening hours exception policy', () => {
  it('normalizes an open exception and sorts intervals', () => {
    const result = validateAndNormalizeException(
      base({
        intervals: [
          { opens: '15:00', closes: '18:00' },
          { opens: '09:00', closes: '13:00' },
        ],
        label: '  Inventaire  ',
        customerMessage: '   ',
      }),
      now,
    );
    expect(result).toEqual({
      localDate: '2026-10-05',
      closed: false,
      label: 'Inventaire',
      customerMessage: null,
      intervals: [
        {
          opensMinute: 540,
          closesMinute: 780,
          closesNextDay: false,
          sortOrder: 0,
        },
        {
          opensMinute: 900,
          closesMinute: 1080,
          closesNextDay: false,
          sortOrder: 1,
        },
      ],
    });
  });

  it('treats closes=00:00 as midnight and 00:00→00:00 as the whole date', () => {
    expect(
      validateAndNormalizeException(
        base({ intervals: [{ opens: '18:00', closes: '00:00' }] }),
        now,
      ).intervals[0],
    ).toEqual({
      opensMinute: 1080,
      closesMinute: 0,
      closesNextDay: true,
      sortOrder: 0,
    });
    expect(
      validateAndNormalizeException(
        base({ intervals: [{ opens: '00:00', closes: '00:00' }] }),
        now,
      ).intervals[0],
    ).toEqual({
      opensMinute: 0,
      closesMinute: 0,
      closesNextDay: true,
      sortOrder: 0,
    });
  });

  it('accepts adjacent intervals and a closed date without intervals', () => {
    expect(
      validateAndNormalizeException(
        base({
          intervals: [
            { opens: '09:00', closes: '12:00' },
            { opens: '12:00', closes: '14:00' },
          ],
        }),
        now,
      ).intervals,
    ).toHaveLength(2);
    expect(
      validateAndNormalizeException(base({ closed: true, intervals: [] }), now),
    ).toMatchObject({ closed: true, intervals: [] });
  });

  it('rejects overnight, zero-length, overlapping and malformed intervals', () => {
    expectInvalid({ intervals: [{ opens: '22:00', closes: '02:00' }] });
    expectInvalid({ intervals: [{ opens: '10:00', closes: '10:00' }] });
    expectInvalid({
      intervals: [
        { opens: '09:00', closes: '13:00' },
        { opens: '12:00', closes: '15:00' },
      ],
    });
    expectInvalid({
      intervals: [
        { opens: '18:00', closes: '00:00' },
        { opens: '20:00', closes: '21:00' },
      ],
    });
    expectInvalid({ intervals: [{ opens: '9:00', closes: '13:00' }] });
    expectInvalid({ intervals: [{ opens: '09:00', closes: '24:00' }] });
    expectInvalid({ intervals: [] });
    expectInvalid({
      intervals: [
        { opens: '01:00', closes: '02:00' },
        { opens: '03:00', closes: '04:00' },
        { opens: '05:00', closes: '06:00' },
        { opens: '07:00', closes: '08:00' },
      ],
    });
    expectInvalid({ closed: true });
  });

  it('enforces the date window today..today+365 in Africa/Algiers', () => {
    expect(
      validateAndNormalizeException(base({ date: '2026-10-02' }), now)
        .localDate,
    ).toBe('2026-10-02');
    expectInvalid({ date: '2026-10-01' });
    expect(
      validateAndNormalizeException(base({ date: '2027-10-02' }), now)
        .localDate,
    ).toBe('2027-10-02');
    expectInvalid({ date: '2027-10-03' });
    expectInvalid({ date: '2026-02-30' });
    expectInvalid({ date: '2026-10-5' });
    // 23:30Z on 2026-10-02 is already 2026-10-03 in Algiers.
    const lateUtc = new Date('2026-10-02T23:30:00Z');
    expect(() =>
      validateAndNormalizeException(base({ date: '2026-10-02' }), lateUtc),
    ).toThrow(
      expect.objectContaining({ code: 'OPENING_HOURS_EXCEPTION_INVALID' }),
    );
    expect(localDateKeyPlusDays(lateUtc, 0)).toBe('2026-10-03');
  });

  it('validates label and customer message lengths', () => {
    expectInvalid({ label: '   ' });
    expectInvalid({ label: 'x'.repeat(81) });
    expectInvalid({ customerMessage: 'x'.repeat(501) });
    expectInvalid({ customerMessage: 12 });
    expect(
      validateAndNormalizeException(
        base({ customerMessage: ' Fermé pour inventaire ' }),
        now,
      ).customerMessage,
    ).toBe('Fermé pour inventaire');
  });

  it('isStrictCivilDate accepts only real dates', () => {
    expect(isStrictCivilDate('2028-02-29')).toBe(true);
    expect(isStrictCivilDate('2027-02-29')).toBe(false);
    expect(isStrictCivilDate('2026-13-01')).toBe(false);
    expect(isStrictCivilDate(20261005)).toBe(false);
  });
});
