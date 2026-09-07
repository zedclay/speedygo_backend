import {
  isRuleEffectiveAt,
  isTimeInWindow,
  localTimeOfDaySeconds,
  pricingRulesApplicabilityConflict,
  DELIVERY_PRICING_TIMEZONE,
} from './pricing-applicability.policy';

describe('pricing applicability conflict (same-selector)', () => {
  it('uses Africa/Algiers', () => {
    expect(DELIVERY_PRICING_TIMEZONE).toBe('Africa/Algiers');
    expect(localTimeOfDaySeconds(new Date('2026-01-15T10:00:00.000Z'))).toBe(
      11 * 3600,
    );
  });

  it('effective window is half-open [from, to)', () => {
    const rule = {
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-06-01T00:00:00.000Z',
    };
    expect(isRuleEffectiveAt(rule, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      true,
    );
    expect(isRuleEffectiveAt(rule, new Date('2026-06-01T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('local windows are inclusive on both ends', () => {
    expect(isTimeInWindow(8 * 3600, 8 * 3600, 18 * 3600)).toBe(true);
    expect(isTimeInWindow(18 * 3600, 8 * 3600, 18 * 3600)).toBe(true);
    expect(isTimeInWindow(18 * 3600 + 1, 8 * 3600, 18 * 3600)).toBe(false);
  });

  it('rejects identical all-day overlapping effective windows', () => {
    const a = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: null,
      endLocalTime: null,
    };
    const b = { ...a };
    expect(pricingRulesApplicabilityConflict(a, b)).toBe(true);
  });

  it('allows adjacent half-open effective windows with same local window', () => {
    const a = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: '2025-01-01T00:00:00.000Z',
      startLocalTime: null,
      endLocalTime: null,
    };
    const b = {
      effectiveFrom: '2025-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: null,
      endLocalTime: null,
    };
    expect(pricingRulesApplicabilityConflict(a, b)).toBe(false);
  });

  it('allows disjoint local windows with overlapping effective', () => {
    const a = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '08:00:00',
      endLocalTime: '11:59:59',
    };
    const b = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '12:00:00',
      endLocalTime: '17:59:59',
    };
    expect(pricingRulesApplicabilityConflict(a, b)).toBe(false);
  });

  it('rejects local windows that share an inclusive endpoint second', () => {
    const a = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '08:00:00',
      endLocalTime: '12:00:00',
    };
    const b = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '12:00:00',
      endLocalTime: '18:00:00',
    };
    expect(pricingRulesApplicabilityConflict(a, b)).toBe(true);
  });

  it('rejects contained local windows', () => {
    const a = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '08:00:00',
      endLocalTime: '18:00:00',
    };
    const b = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '10:00:00',
      endLocalTime: '12:00:00',
    };
    expect(pricingRulesApplicabilityConflict(a, b)).toBe(true);
  });

  it('detects overnight local-window conflicts', () => {
    const night = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '22:00:00',
      endLocalTime: '06:00:00',
    };
    const early = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '05:00:00',
      endLocalTime: '09:00:00',
    };
    expect(pricingRulesApplicabilityConflict(night, early)).toBe(true);
  });

  it('allows overnight window adjacent to daytime without shared second', () => {
    const night = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '22:00:00',
      endLocalTime: '05:59:59',
    };
    const day = {
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      startLocalTime: '06:00:00',
      endLocalTime: '21:59:59',
    };
    expect(pricingRulesApplicabilityConflict(night, day)).toBe(false);
  });
});
