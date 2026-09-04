import {
  computeCodOutstandingAsOf,
  computeCodPeriodNetMovement,
  moneyMinorToString,
  parseReportInstant,
  REPORTS_MAX_WINDOW_MS,
  validateReportWindow,
  normalizeReportListQuery,
} from './reports.policy';

describe('Reports policy', () => {
  describe('parseReportInstant / validateReportWindow', () => {
    it('accepts RFC3339 UTC instants and enforces half-open from < to', () => {
      const ok = validateReportWindow(
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      );
      expect('error' in ok).toBe(false);
      if (!('error' in ok)) {
        expect(ok.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(ok.to.toISOString()).toBe('2026-01-02T00:00:00.000Z');
      }
    });

    it('rejects bare YYYY-MM-DD (no local timezone interpretation)', () => {
      expect(parseReportInstant('2026-01-01')).toBeNull();
      const rejected = validateReportWindow('2026-01-01', '2026-01-02');
      expect('error' in rejected).toBe(true);
      if ('error' in rejected) {
        expect(rejected.error).toContain('RFC3339');
      }
    });

    it('rejects from >= to', () => {
      const inverted = validateReportWindow(
        '2026-01-02T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );
      expect('error' in inverted).toBe(true);
      if ('error' in inverted) {
        expect(inverted.error).toContain('strictly before');
      }
      const equal = validateReportWindow(
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );
      expect('error' in equal).toBe(true);
      if ('error' in equal) {
        expect(equal.error).toContain('strictly before');
      }
    });

    it('rejects windows longer than 93 days', () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date(from.getTime() + REPORTS_MAX_WINDOW_MS + 1);
      const rejected = validateReportWindow(
        from.toISOString(),
        to.toISOString(),
      );
      expect('error' in rejected).toBe(true);
      if ('error' in rejected) {
        expect(rejected.error).toContain('93 days');
      }
    });
  });

  describe('normalizeReportListQuery', () => {
    it('clamps limit and offset', () => {
      expect(normalizeReportListQuery({ limit: 9999, offset: -5 })).toEqual({
        limit: 100,
        offset: 0,
      });
      expect(normalizeReportListQuery({})).toEqual({ limit: 50, offset: 0 });
    });
  });

  describe('moneyMinorToString', () => {
    it('preserves bigint as string without Number conversion', () => {
      const large = BigInt('9007199254740993');
      expect(moneyMinorToString(large)).toBe('9007199254740993');
      expect(moneyMinorToString(null)).toBe('0');
    });
  });

  describe('COD flow vs as-of outstanding', () => {
    it('keeps prior history in as-of position but not in period net movement', () => {
      const to = '2026-03-08T00:00:00.000Z';
      // Spec example: 100 before from, 50 inside period, remittance allocation 70 inside period.
      const outstanding = computeCodOutstandingAsOf({
        collections: [
          { collectedAt: '2026-02-20T00:00:00.000Z', amountMinor: 100 },
          { collectedAt: '2026-03-03T00:00:00.000Z', amountMinor: 50 },
        ],
        confirmedAllocations: [
          {
            remittanceConfirmedAt: '2026-03-04T00:00:00.000Z',
            amountMinor: 70,
          },
        ],
        asOfToIso: to,
      });
      expect(outstanding).toBe(80n);
      const periodNet = computeCodPeriodNetMovement({
        collectedDuringPeriodMinor: 50,
        confirmedRemittedDuringPeriodMinor: 70,
      });
      expect(periodNet).toBe(-20n);
      expect(outstanding).not.toBe(periodNet);
    });

    it('excludes events at or after asOfTo from outstanding', () => {
      const outstanding = computeCodOutstandingAsOf({
        collections: [
          { collectedAt: '2026-03-08T00:00:00.000Z', amountMinor: 999 },
        ],
        confirmedAllocations: [],
        asOfToIso: '2026-03-08T00:00:00.000Z',
      });
      expect(outstanding).toBe(0n);
    });
  });
});
