import {
  CHECKOUT_PRICING_TIMEZONE,
  customerTotalMinor,
  isRuleEffectiveAt,
  isTimeInWindow,
  localTimeOfDaySeconds,
  parseTimeOfDaySeconds,
  requireSinglePricingRule,
  ruleAppliesAtLocalTime,
  selectApplicablePricingRules,
} from './checkout.policy';
import { CHECKOUT_ERROR_CODES, CheckoutError } from './checkout.errors';
import type { CheckoutPricingRuleRecord } from './checkout.types';

function rule(
  overrides: Partial<CheckoutPricingRuleRecord> = {},
): CheckoutPricingRuleRecord {
  return {
    id: 'rule-1',
    zoneId: 'zone-1',
    name: 'Day',
    timeBand: 'DAY',
    startLocalTime: '08:00:00',
    endLocalTime: '17:59:59',
    customerDeliveryFeeMinor: 500,
    driverRemunerationMinor: 300,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    active: true,
    ...overrides,
  };
}

describe('Checkout pricing policy', () => {
  it('evaluates local time in Africa/Algiers, not raw UTC hour', () => {
    expect(CHECKOUT_PRICING_TIMEZONE).toBe('Africa/Algiers');
    const utcTen = new Date('2026-01-15T10:00:00.000Z');
    expect(localTimeOfDaySeconds(utcTen)).toBe(11 * 3600);
  });

  it('parses TIME strings', () => {
    expect(parseTimeOfDaySeconds('08:00:00')).toBe(8 * 3600);
    expect(parseTimeOfDaySeconds('23:59:59')).toBe(23 * 3600 + 59 * 60 + 59);
    expect(parseTimeOfDaySeconds('not-a-time')).toBeNull();
    expect(parseTimeOfDaySeconds('24:00:00')).toBeNull();
  });

  it('treats inclusive windows and midnight wrap', () => {
    expect(isTimeInWindow(8 * 3600, 8 * 3600, 18 * 3600)).toBe(true);
    expect(isTimeInWindow(18 * 3600, 8 * 3600, 18 * 3600)).toBe(true);
    expect(isTimeInWindow(7 * 3600, 8 * 3600, 18 * 3600)).toBe(false);
    expect(isTimeInWindow(23 * 3600, 22 * 3600, 6 * 3600)).toBe(true);
    expect(isTimeInWindow(5 * 3600, 22 * 3600, 6 * 3600)).toBe(true);
    expect(isTimeInWindow(12 * 3600, 22 * 3600, 6 * 3600)).toBe(false);
  });

  it('treats both-null windows as all-day eligible', () => {
    expect(
      ruleAppliesAtLocalTime({
        timeBand: 'DAY',
        startLocalTime: null,
        endLocalTime: null,
        nowSeconds: 3 * 3600,
      }),
    ).toBe(true);
    expect(
      ruleAppliesAtLocalTime({
        timeBand: 'NIGHT',
        startLocalTime: null,
        endLocalTime: null,
        nowSeconds: 15 * 3600,
      }),
    ).toBe(true);
  });

  it('does not invent default DAY or NIGHT hours', () => {
    const nightInstant = new Date('2026-01-15T02:00:00.000Z');
    const allDayDayBand = rule({
      timeBand: 'DAY',
      startLocalTime: null,
      endLocalTime: null,
    });
    const allDayNightBand = rule({
      id: 'night-all',
      timeBand: 'NIGHT',
      startLocalTime: null,
      endLocalTime: null,
    });
    expect(localTimeOfDaySeconds(nightInstant)).toBe(3 * 3600);
    expect(selectApplicablePricingRules([allDayDayBand], nightInstant)).toEqual(
      [allDayDayBand],
    );
    expect(
      selectApplicablePricingRules([allDayNightBand], nightInstant),
    ).toEqual([allDayNightBand]);
  });

  it('applies an explicit same-day interval', () => {
    expect(
      ruleAppliesAtLocalTime({
        timeBand: 'CUSTOM',
        startLocalTime: '08:00:00',
        endLocalTime: '17:59:59',
        nowSeconds: 12 * 3600,
      }),
    ).toBe(true);
    expect(
      ruleAppliesAtLocalTime({
        timeBand: 'CUSTOM',
        startLocalTime: '08:00:00',
        endLocalTime: '17:59:59',
        nowSeconds: 7 * 3600,
      }),
    ).toBe(false);
  });

  it('fails closed when exactly one local time bound is set', () => {
    expect(() =>
      ruleAppliesAtLocalTime({
        timeBand: 'DAY',
        startLocalTime: '08:00:00',
        endLocalTime: null,
        nowSeconds: 12 * 3600,
      }),
    ).toThrow(CheckoutError);
    expect(() =>
      ruleAppliesAtLocalTime({
        timeBand: 'NIGHT',
        startLocalTime: null,
        endLocalTime: '06:00:00',
        nowSeconds: 23 * 3600,
      }),
    ).toThrow(CheckoutError);
    const now = new Date('2026-01-15T10:00:00.000Z');
    expect(() =>
      selectApplicablePricingRules(
        [rule({ startLocalTime: '08:00:00', endLocalTime: null })],
        now,
      ),
    ).toThrow(CheckoutError);
  });

  it('ignores expired and future effective dates', () => {
    const now = new Date('2026-06-01T10:00:00.000Z');
    expect(
      isRuleEffectiveAt(
        rule({
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: '2026-05-01T00:00:00.000Z',
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isRuleEffectiveAt(
        rule({ effectiveFrom: '2026-07-01T00:00:00.000Z' }),
        now,
      ),
    ).toBe(false);
    expect(
      isRuleEffectiveAt(
        rule({
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: '2026-12-01T00:00:00.000Z',
        }),
        now,
      ),
    ).toBe(true);
  });

  it('selects DAY, NIGHT, and CUSTOM by injected evaluation instant and explicit windows', () => {
    const day = rule({
      id: 'day',
      timeBand: 'DAY',
      startLocalTime: '08:00:00',
      endLocalTime: '17:59:59',
    });
    const night = rule({
      id: 'night',
      timeBand: 'NIGHT',
      startLocalTime: '18:00:00',
      endLocalTime: '07:59:59',
      customerDeliveryFeeMinor: 800,
    });
    const custom = rule({
      id: 'custom',
      timeBand: 'CUSTOM',
      startLocalTime: '12:00:00',
      endLocalTime: '12:30:00',
      customerDeliveryFeeMinor: 1000,
    });
    const midday = new Date('2026-01-15T10:00:00.000Z');
    const evening = new Date('2026-01-15T18:00:00.000Z');
    const lunch = new Date('2026-01-15T11:15:00.000Z');
    expect(selectApplicablePricingRules([day, night, custom], midday)).toEqual([
      day,
    ]);
    expect(selectApplicablePricingRules([day, night, custom], evening)).toEqual(
      [night],
    );
    expect(selectApplicablePricingRules([custom], lunch)).toEqual([custom]);
  });

  it('fails closed when no rule matches or several match', () => {
    const now = new Date('2026-01-15T10:00:00.000Z');
    expect(() => requireSinglePricingRule([])).toThrow(CheckoutError);
    try {
      requireSinglePricingRule([]);
    } catch (error) {
      expect(error).toMatchObject({
        code: CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_RULE_NOT_FOUND,
      });
    }
    expect(() =>
      requireSinglePricingRule([rule({ id: 'a' }), rule({ id: 'b' })]),
    ).toThrow(CheckoutError);
    const expired = rule({
      id: 'expired',
      effectiveTo: '2020-01-01T00:00:00.000Z',
    });
    expect(selectApplicablePricingRules([expired], now)).toEqual([]);
    const overlapping = selectApplicablePricingRules(
      [
        rule({
          id: 'a',
          startLocalTime: null,
          endLocalTime: null,
        }),
        rule({
          id: 'b',
          timeBand: 'CUSTOM',
          startLocalTime: null,
          endLocalTime: null,
        }),
      ],
      now,
    );
    expect(overlapping).toHaveLength(2);
    try {
      requireSinglePricingRule(overlapping);
    } catch (error) {
      expect(error).toMatchObject({
        code: CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
      });
    }
  });

  it('adds merchandise and a flat delivery fee in integer minor units', () => {
    expect(customerTotalMinor(1200, 500)).toBe(1700);
    expect(customerTotalMinor(0, 0)).toBe(0);
    expect(() => customerTotalMinor(1.5, 0)).toThrow();
    expect(() => customerTotalMinor(-1, 0)).toThrow();
  });
});
