import {
  formatRatingAverage,
  isDeliveryEligibleForDriverRating,
  isHistoricalServingAssignment,
  isOrderEligibleForRating,
  normalizeRatingComment,
  parseMerchantSummaryIds,
  parseRatingScore,
  RATING_SCORE_MAX,
  RATING_SCORE_MIN,
} from './ratings.policy';

describe('RatingsPolicy', () => {
  describe('score scale', () => {
    it('accepts integers 1..5 only', () => {
      expect(parseRatingScore(RATING_SCORE_MIN)).toBe(1);
      expect(parseRatingScore(3)).toBe(3);
      expect(parseRatingScore(RATING_SCORE_MAX)).toBe(5);
      expect(parseRatingScore(0)).toBeNull();
      expect(parseRatingScore(6)).toBeNull();
      expect(parseRatingScore(3.5)).toBeNull();
      expect(parseRatingScore('3')).toBeNull();
      expect(parseRatingScore(NaN)).toBeNull();
    });
  });

  describe('comment', () => {
    it('treats missing/blank as null and bounds length', () => {
      expect(normalizeRatingComment(undefined)).toEqual({
        ok: true,
        comment: null,
      });
      expect(normalizeRatingComment('  ')).toEqual({ ok: true, comment: null });
      expect(normalizeRatingComment('  nice  ')).toEqual({
        ok: true,
        comment: 'nice',
      });
      expect(normalizeRatingComment('x'.repeat(2001)).ok).toBe(false);
    });
  });

  describe('eligibility', () => {
    it('requires COMPLETED order and DELIVERED delivery for driver path', () => {
      expect(isOrderEligibleForRating('COMPLETED')).toBe(true);
      expect(isOrderEligibleForRating('ACTIVE')).toBe(false);
      expect(isOrderEligibleForRating('CANCELLED')).toBe(false);
      expect(isOrderEligibleForRating('FAILED')).toBe(false);
      expect(isDeliveryEligibleForDriverRating('DELIVERED')).toBe(true);
      expect(isDeliveryEligibleForDriverRating('IN_TRANSIT')).toBe(false);
    });
  });

  describe('historical serving assignment', () => {
    it('accepts RELEASED assignment after Delivery completion', () => {
      expect(
        isHistoricalServingAssignment({
          status: 'RELEASED',
          acceptedAt: '2026-01-01T00:00:00.000Z',
          releasedAt: '2026-01-01T01:00:00.000Z',
        }),
      ).toBe(true);
    });

    it('rejects REJECTED / EXPIRED / OFFERED even when releasedAt is set', () => {
      expect(
        isHistoricalServingAssignment({
          status: 'REJECTED',
          acceptedAt: null,
          releasedAt: '2026-01-01T00:00:00.000Z',
        }),
      ).toBe(false);
      expect(
        isHistoricalServingAssignment({
          status: 'EXPIRED',
          acceptedAt: null,
          releasedAt: '2026-01-01T00:00:00.000Z',
        }),
      ).toBe(false);
      expect(
        isHistoricalServingAssignment({
          status: 'OFFERED',
          acceptedAt: null,
          releasedAt: null,
        }),
      ).toBe(false);
    });

    it('rejects RELEASED without acceptedAt', () => {
      expect(
        isHistoricalServingAssignment({
          status: 'RELEASED',
          acceptedAt: null,
          releasedAt: '2026-01-01T01:00:00.000Z',
        }),
      ).toBe(false);
    });
  });

  describe('average', () => {
    it('returns null for zero ratings and rounds to two decimals', () => {
      expect(formatRatingAverage(0, 0)).toBeNull();
      expect(formatRatingAverage(5, 1)).toBe(5);
      expect(formatRatingAverage(10, 3)).toBe(3.33);
      expect(formatRatingAverage(14, 3)).toBe(4.67);
      expect(formatRatingAverage(9, 2)).toBe(4.5);
      expect(formatRatingAverage(13, 3)).toBe(4.33);
    });
  });

  describe('merchant summary batch ids', () => {
    it('parses unique UUIDs and rejects invalid input', () => {
      expect(parseMerchantSummaryIds('')).toEqual([]);
      expect(
        parseMerchantSummaryIds(
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd,DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD',
        ),
      ).toEqual(['dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
      expect(parseMerchantSummaryIds('not-a-uuid')).toBeNull();
      expect(parseMerchantSummaryIds(1)).toBeNull();
    });
  });
});
