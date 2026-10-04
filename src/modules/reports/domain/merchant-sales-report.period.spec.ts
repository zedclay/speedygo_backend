import {
  MerchantReportPeriodError,
  resolveMerchantReportPeriod,
} from './merchant-sales-report.period';

// 2031-03-15 is a Saturday. Africa/Algiers is UTC+01:00 (no DST).
const SAT_1130_LOCAL = new Date('2031-03-15T10:30:00.000Z');

function iso(date: Date): string {
  return date.toISOString();
}

describe('resolveMerchantReportPeriod', () => {
  it('TODAY is the local day with hourly buckets up to the current hour', () => {
    const p = resolveMerchantReportPeriod({
      period: 'TODAY',
      now: SAT_1130_LOCAL,
    });
    expect(iso(p.from)).toBe('2031-03-14T23:00:00.000Z');
    expect(iso(p.to)).toBe('2031-03-15T23:00:00.000Z');
    expect(p.localFrom).toBe('2031-03-15');
    expect(p.localToInclusive).toBe('2031-03-15');
    expect(p.granularity).toBe('HOUR');
    expect(p.buckets.map((b) => b.key)).toEqual(
      Array.from(
        { length: 12 },
        (_, h) => `2031-03-15T${String(h).padStart(2, '0')}`,
      ),
    );
    expect(iso(p.buckets[0].start)).toBe('2031-03-14T23:00:00.000Z');
    expect(p.buckets[11].localStart).toBe('2031-03-15T11:00');
  });

  it('YESTERDAY is the previous full local day (24 hourly buckets)', () => {
    const p = resolveMerchantReportPeriod({
      period: 'YESTERDAY',
      now: SAT_1130_LOCAL,
    });
    expect(iso(p.from)).toBe('2031-03-13T23:00:00.000Z');
    expect(iso(p.to)).toBe('2031-03-14T23:00:00.000Z');
    expect(p.buckets).toHaveLength(24);
    expect(p.buckets[23].key).toBe('2031-03-14T23');
  });

  it('THIS_WEEK starts Monday local midnight; daily buckets stop at today', () => {
    const p = resolveMerchantReportPeriod({
      period: 'THIS_WEEK',
      now: SAT_1130_LOCAL,
    });
    expect(p.localFrom).toBe('2031-03-10');
    expect(p.localToInclusive).toBe('2031-03-16');
    expect(iso(p.from)).toBe('2031-03-09T23:00:00.000Z');
    expect(iso(p.to)).toBe('2031-03-16T23:00:00.000Z');
    expect(p.granularity).toBe('DAY');
    expect(p.buckets.map((b) => b.key)).toEqual([
      '2031-03-10',
      '2031-03-11',
      '2031-03-12',
      '2031-03-13',
      '2031-03-14',
      '2031-03-15',
    ]);
  });

  it('THIS_WEEK on a Sunday still starts on the preceding Monday', () => {
    const p = resolveMerchantReportPeriod({
      period: 'THIS_WEEK',
      now: new Date('2031-03-16T12:00:00.000Z'),
    });
    expect(p.localFrom).toBe('2031-03-10');
    expect(p.buckets).toHaveLength(7);
  });

  it('THIS_MONTH covers the calendar month; buckets through today', () => {
    const p = resolveMerchantReportPeriod({
      period: 'THIS_MONTH',
      now: SAT_1130_LOCAL,
    });
    expect(iso(p.from)).toBe('2031-02-28T23:00:00.000Z');
    expect(iso(p.to)).toBe('2031-03-31T23:00:00.000Z');
    expect(p.buckets).toHaveLength(15);
    expect(p.buckets[14].key).toBe('2031-03-15');
  });

  it('uses the Algiers civil date, not the UTC date, around midnight', () => {
    // 23:30Z on the 14th is 00:30 local on the 15th.
    const justAfterLocalMidnight = resolveMerchantReportPeriod({
      period: 'TODAY',
      now: new Date('2031-03-14T23:30:00.000Z'),
    });
    expect(justAfterLocalMidnight.localFrom).toBe('2031-03-15');
    expect(justAfterLocalMidnight.buckets.map((b) => b.key)).toEqual([
      '2031-03-15T00',
    ]);

    const lastLocalSecond = resolveMerchantReportPeriod({
      period: 'TODAY',
      now: new Date('2031-03-15T22:59:59.000Z'),
    });
    expect(lastLocalSecond.localFrom).toBe('2031-03-15');
    expect(lastLocalSecond.buckets).toHaveLength(24);
  });

  it('THIS_MONTH rolls over the year in local time', () => {
    const p = resolveMerchantReportPeriod({
      period: 'THIS_MONTH',
      now: new Date('2031-12-31T23:30:00.000Z'),
    });
    expect(p.localFrom).toBe('2032-01-01');
    expect(p.localToInclusive).toBe('2032-01-31');
    expect(iso(p.from)).toBe('2031-12-31T23:00:00.000Z');
    expect(iso(p.to)).toBe('2032-01-31T23:00:00.000Z');
  });

  it('CUSTOM uses inclusive local dates', () => {
    const range = resolveMerchantReportPeriod({
      period: 'CUSTOM',
      now: SAT_1130_LOCAL,
      from: '2031-03-01',
      to: '2031-03-15',
    });
    expect(iso(range.from)).toBe('2031-02-28T23:00:00.000Z');
    expect(iso(range.to)).toBe('2031-03-15T23:00:00.000Z');
    expect(range.granularity).toBe('DAY');
    expect(range.buckets).toHaveLength(15);

    const singlePastDay = resolveMerchantReportPeriod({
      period: 'CUSTOM',
      now: SAT_1130_LOCAL,
      from: '2031-03-02',
      to: '2031-03-02',
    });
    expect(singlePastDay.granularity).toBe('HOUR');
    expect(singlePastDay.buckets).toHaveLength(24);
  });

  it.each([
    [undefined, undefined],
    ['2031-03-10', undefined],
    ['2031-02-30', '2031-03-01'],
    ['2031-03-10', '2031-03-09'],
    ['2031-03-10', '2031-03-16'],
    ['2030-12-01', '2031-03-15'],
    ['15/03/2031', '2031-03-15'],
  ])('CUSTOM rejects from=%s to=%s', (from, to) => {
    expect(() =>
      resolveMerchantReportPeriod({
        period: 'CUSTOM',
        now: SAT_1130_LOCAL,
        from,
        to,
      }),
    ).toThrow(MerchantReportPeriodError);
  });

  it('CUSTOM accepts exactly 93 days', () => {
    const p = resolveMerchantReportPeriod({
      period: 'CUSTOM',
      now: SAT_1130_LOCAL,
      from: '2030-12-13',
      to: '2031-03-15',
    });
    expect(p.buckets).toHaveLength(93);
  });

  it.each(['TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH'] as const)(
    '%s rejects explicit from/to',
    (period) => {
      expect(() =>
        resolveMerchantReportPeriod({
          period,
          now: SAT_1130_LOCAL,
          from: '2031-03-10',
        }),
      ).toThrow(MerchantReportPeriodError);
    },
  );
});
