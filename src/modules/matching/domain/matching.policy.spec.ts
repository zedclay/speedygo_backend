import {
  haversineMeters,
  isLocationFresh,
  isOfferExpired,
  isOpenOffer,
  isValidLocation,
  isWithinPickupRadius,
  offerExpiresAt,
  rankCandidates,
} from './matching.policy';

describe('Matching policy', () => {
  it('validates coordinates and rejects non-finite values', () => {
    expect(isValidLocation(36.75, 3.05)).toBe(true);
    expect(isValidLocation(91, 0)).toBe(false);
    expect(isValidLocation(0, 181)).toBe(false);
    expect(isValidLocation(Number.NaN, 0)).toBe(false);
  });

  it('treats missing and stale locations as not fresh', () => {
    const now = Date.parse('2026-09-02T00:00:00.000Z');
    expect(isLocationFresh('2026-09-02T00:00:00.000Z', 45_000, now)).toBe(true);
    expect(isLocationFresh('2026-09-01T23:59:15.000Z', 45_000, now)).toBe(true);
    expect(isLocationFresh('2026-09-01T23:59:14.999Z', 45_000, now)).toBe(
      false,
    );
    expect(isLocationFresh('not-a-date', 45_000, now)).toBe(false);
  });

  it('derives offer expiry from assignedAt', () => {
    expect(offerExpiresAt('2026-09-02T00:00:00.000Z', 30_000)).toBe(
      '2026-09-02T00:00:30.000Z',
    );
    expect(
      isOfferExpired(
        '2026-09-02T00:00:00.000Z',
        30_000,
        Date.parse('2026-09-02T00:00:30.000Z'),
      ),
    ).toBe(true);
    expect(isOpenOffer('OFFERED', null)).toBe(true);
    expect(isOpenOffer('OFFERED', '2026-09-02T00:00:30.000Z')).toBe(false);
  });

  it('ranks nearer Drivers first and ties by driverId', () => {
    const ranked = rankCandidates([
      { driverId: 'b', distanceMeters: 100 },
      { driverId: 'a', distanceMeters: 100 },
      { driverId: 'c', distanceMeters: 50 },
    ]);
    expect(ranked.map((row) => row.driverId)).toEqual(['c', 'a', 'b']);
  });

  it('includes the 5 km pickup boundary and excludes beyond it', () => {
    expect(isWithinPickupRadius(5000, 5000)).toBe(true);
    expect(isWithinPickupRadius(4999, 5000)).toBe(true);
    expect(isWithinPickupRadius(5001, 5000)).toBe(false);
  });

  it('computes pickup distance in meters', () => {
    const meters = haversineMeters(36.75, 3.05, 36.751, 3.051);
    expect(meters).toBeGreaterThan(0);
    expect(meters).toBeLessThan(200);
  });
});
