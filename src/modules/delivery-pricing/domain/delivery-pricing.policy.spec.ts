import { validateCreatePricingRuleInput } from './delivery-pricing.policy';
import { DeliveryPricingError } from './delivery-pricing.errors';
import type { CreateDeliveryPricingRuleInput } from './delivery-pricing.types';

describe('delivery-pricing.policy', () => {
  const BASE: CreateDeliveryPricingRuleInput = {
    zoneId: 'zone-1',
    name: 'All day',
    timeBand: 'DAY',
    startLocalTime: null,
    endLocalTime: null,
    customerDeliveryFeeMinor: 500n,
    driverRemunerationMinor: 300n,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
  };

  it('accepts a valid rule with no time window', () => {
    expect(() => validateCreatePricingRuleInput(BASE)).not.toThrow();
  });

  it('accepts a valid rule with both times set', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        timeBand: 'CUSTOM',
        startLocalTime: '08:00:00',
        endLocalTime: '20:00:00',
      }),
    ).not.toThrow();
  });

  it('accepts fee === remuneration (equal is allowed)', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        customerDeliveryFeeMinor: 300n,
        driverRemunerationMinor: 300n,
      }),
    ).not.toThrow();
  });

  it('rejects invalid timeBand', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        timeBand: 'DAWN' as 'DAY',
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects only startLocalTime set without endLocalTime', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        startLocalTime: '08:00:00',
        endLocalTime: null,
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects only endLocalTime set without startLocalTime', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        startLocalTime: null,
        endLocalTime: '20:00:00',
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects negative customerDeliveryFeeMinor', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        customerDeliveryFeeMinor: -1n,
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects negative driverRemunerationMinor', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        driverRemunerationMinor: -1n,
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects remuneration > fee', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        customerDeliveryFeeMinor: 300n,
        driverRemunerationMinor: 400n,
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects effectiveTo <= effectiveFrom', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveTo: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('rejects effectiveTo === effectiveFrom', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveTo: '2025-01-01T00:00:00.000Z',
      }),
    ).toThrow(DeliveryPricingError);
  });

  it('accepts effectiveTo strictly after effectiveFrom', () => {
    expect(() =>
      validateCreatePricingRuleInput({
        ...BASE,
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveTo: '2026-01-01T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('stores the correct error code DELIVERY_PRICING_RULE_INVALID', () => {
    try {
      validateCreatePricingRuleInput({ ...BASE, timeBand: 'DAWN' as 'DAY' });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as DeliveryPricingError).code).toBe(
        'DELIVERY_PRICING_RULE_INVALID',
      );
    }
  });
});
