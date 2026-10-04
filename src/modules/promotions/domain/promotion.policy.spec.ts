import {
  allocateDiscountByFunding,
  assertPromotionEffective,
  buildPromotionDecision,
  calculateDiscountAmountMinor,
  compareDiscoverablePromotions,
  isPromotionDiscoverable,
  normalizeCustomerLabel,
  normalizePromotionCode,
  parsePromotionType,
  requirePositiveCustomerPayableAfterPromotion,
  toCustomerDiscoverablePromotion,
} from './promotion.policy';
import { PROMOTION_ERROR_CODES } from './promotion.errors';
import {
  PROMOTION_FUNDING_MERCHANT,
  PROMOTION_FUNDING_SPEEDYGO,
  PROMOTION_KIND_FIXED_MINOR,
  PROMOTION_KIND_RATE_BPS,
  PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
  PROMOTION_TYPE_MERCHANT_RATE_BPS,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
} from './promotion.types';

function basePromo(
  overrides: Partial<{
    id: string;
    code: string;
    type: string;
    value: number;
    active: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? 'p1',
    code: overrides.code ?? 'SAVE10',
    type: overrides.type ?? PROMOTION_TYPE_MERCHANT_RATE_BPS,
    value: overrides.value ?? 1000,
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    active: overrides.active ?? true,
    customerDiscoverable: false,
    customerLabel: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };
}

describe('promotion.policy', () => {
  it('normalizes codes with trim + uppercase', () => {
    expect(normalizePromotionCode('  save10 ')).toBe('SAVE10');
  });

  it('rejects invalid codes', () => {
    try {
      normalizePromotionCode('bad code');
      fail('expected throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: PROMOTION_ERROR_CODES.PROMOTION_CODE_INVALID,
      });
    }
  });

  it('parses all four funding-encoded types', () => {
    expect(parsePromotionType(PROMOTION_TYPE_MERCHANT_RATE_BPS)).toEqual({
      type: PROMOTION_TYPE_MERCHANT_RATE_BPS,
      kind: PROMOTION_KIND_RATE_BPS,
      funding: PROMOTION_FUNDING_MERCHANT,
    });
    expect(parsePromotionType(PROMOTION_TYPE_SPEEDYGO_RATE_BPS)).toEqual({
      type: PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
      kind: PROMOTION_KIND_RATE_BPS,
      funding: PROMOTION_FUNDING_SPEEDYGO,
    });
    expect(parsePromotionType(PROMOTION_TYPE_MERCHANT_FIXED_MINOR)).toEqual({
      type: PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
      kind: PROMOTION_KIND_FIXED_MINOR,
      funding: PROMOTION_FUNDING_MERCHANT,
    });
    expect(parsePromotionType(PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR)).toEqual({
      type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
      kind: PROMOTION_KIND_FIXED_MINOR,
      funding: PROMOTION_FUNDING_SPEEDYGO,
    });
  });

  it('uses BigInt floor for percentage discounts and caps at base', () => {
    expect(
      calculateDiscountAmountMinor({
        kind: PROMOTION_KIND_RATE_BPS,
        value: 1000,
        eligibleBaseMinor: 10001,
      }),
    ).toBe(1000);
    expect(
      calculateDiscountAmountMinor({
        kind: PROMOTION_KIND_FIXED_MINOR,
        value: 5000,
        eligibleBaseMinor: 1200,
      }),
    ).toBe(1200);
  });

  it('allocates funding into snapshot buckets', () => {
    expect(allocateDiscountByFunding(200, PROMOTION_FUNDING_MERCHANT)).toEqual({
      merchantDiscountMinor: 200,
      platformDiscountMinor: 0,
    });
    expect(allocateDiscountByFunding(200, PROMOTION_FUNDING_SPEEDYGO)).toEqual({
      merchantDiscountMinor: 0,
      platformDiscountMinor: 200,
    });
  });

  it('applies half-open effective window', () => {
    const promotion = {
      active: true,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    };
    expect(() =>
      assertPromotionEffective(promotion, new Date('2026-01-01T00:00:00.000Z')),
    ).not.toThrow();
    try {
      assertPromotionEffective(promotion, new Date('2026-02-01T00:00:00.000Z'));
      fail('expected expired at endsAt');
    } catch (error) {
      expect(error).toMatchObject({
        code: PROMOTION_ERROR_CODES.PROMOTION_EXPIRED,
      });
    }
    try {
      assertPromotionEffective(
        { ...promotion, active: false },
        new Date('2026-01-15T00:00:00.000Z'),
      );
      fail('expected inactive');
    } catch (error) {
      expect(error).toMatchObject({
        code: PROMOTION_ERROR_CODES.PROMOTION_INACTIVE,
      });
    }
  });

  it('builds merchant-funded RATE decision buckets', () => {
    const decision = buildPromotionDecision({
      promotion: basePromo({
        type: PROMOTION_TYPE_MERCHANT_RATE_BPS,
        value: 1000,
      }),
      eligibleBaseMinor: 10000,
      decisionAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(decision.discountAmountMinor).toBe(1000);
    expect(decision.merchantDiscountMinor).toBe(1000);
    expect(decision.platformDiscountMinor).toBe(0);
    expect(decision.funding).toBe(PROMOTION_FUNDING_MERCHANT);
  });

  it('builds SPEEDYGO FIXED decision buckets', () => {
    const decision = buildPromotionDecision({
      promotion: basePromo({
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 2000,
        code: 'SG20',
      }),
      eligibleBaseMinor: 10000,
      decisionAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(decision.discountAmountMinor).toBe(2000);
    expect(decision.merchantDiscountMinor).toBe(0);
    expect(decision.platformDiscountMinor).toBe(2000);
    expect(decision.funding).toBe(PROMOTION_FUNDING_SPEEDYGO);
  });

  it('builds SPEEDYGO RATE and MERCHANT FIXED buckets', () => {
    const speedRate = buildPromotionDecision({
      promotion: basePromo({
        type: PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
        value: 2500,
      }),
      eligibleBaseMinor: 10000,
      decisionAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(speedRate.discountAmountMinor).toBe(2500);
    expect(speedRate.platformDiscountMinor).toBe(2500);
    expect(speedRate.merchantDiscountMinor).toBe(0);

    const merchantFixed = buildPromotionDecision({
      promotion: basePromo({
        type: PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
        value: 1500,
      }),
      eligibleBaseMinor: 10000,
      decisionAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(merchantFixed.discountAmountMinor).toBe(1500);
    expect(merchantFixed.merchantDiscountMinor).toBe(1500);
    expect(merchantFixed.platformDiscountMinor).toBe(0);
  });

  it('fails closed when Promotion would leave zero Customer payable', () => {
    try {
      requirePositiveCustomerPayableAfterPromotion({
        merchandiseSubtotalMinor: 1000,
        discountAmountMinor: 1000,
        deliveryFeeMinor: 0,
      });
      fail('expected zero payable unsupported');
    } catch (error) {
      expect(error).toMatchObject({
        code: PROMOTION_ERROR_CODES.PROMOTION_ZERO_PAYABLE_UNSUPPORTED,
      });
    }
  });

  it('allows full merchandise discount when delivery keeps payable positive', () => {
    expect(
      requirePositiveCustomerPayableAfterPromotion({
        merchandiseSubtotalMinor: 1000,
        discountAmountMinor: 1000,
        deliveryFeeMinor: 200,
      }),
    ).toBe(200);
  });

  it('keeps unpublished promotions undiscoverable even when effective', () => {
    expect(
      isPromotionDiscoverable(basePromo(), new Date('2026-01-01T00:00:00.000Z')),
    ).toBe(false);
  });

  it('discovers only published effective promotions', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(
      isPromotionDiscoverable(
        { ...basePromo(), customerDiscoverable: true },
        now,
      ),
    ).toBe(true);
    expect(
      isPromotionDiscoverable(
        { ...basePromo(), customerDiscoverable: true, active: false },
        now,
      ),
    ).toBe(false);
    expect(
      isPromotionDiscoverable(
        {
          ...basePromo(),
          customerDiscoverable: true,
          startsAt: '2027-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
    expect(
      isPromotionDiscoverable(
        {
          ...basePromo(),
          customerDiscoverable: true,
          endsAt: '2026-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
    expect(
      isPromotionDiscoverable(
        {
          ...basePromo(),
          customerDiscoverable: true,
          endsAt: '2026-06-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
  });

  it('strips funding from Customer discovery projection', () => {
    const view = toCustomerDiscoverablePromotion({
      ...basePromo({
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 15000,
      }),
      customerDiscoverable: true,
      customerLabel: 'Offre Spéciale',
    });
    expect(view).toEqual({
      id: 'p1',
      code: 'SAVE10',
      discountKind: PROMOTION_KIND_FIXED_MINOR,
      value: 15000,
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      customerLabel: 'Offre Spéciale',
      eligibility: 'DISCOVERABLE',
    });
    expect(view).not.toHaveProperty('type');
    expect(view).not.toHaveProperty('funding');
    expect(view).not.toHaveProperty('customerDiscoverable');
  });

  it('orders discovery by endsAt then id', () => {
    const earlier = { id: 'b', endsAt: '2026-07-01T00:00:00.000Z' };
    const later = { id: 'a', endsAt: '2026-08-01T00:00:00.000Z' };
    const sameEndA = { id: 'aaa', endsAt: '2026-07-01T00:00:00.000Z' };
    const sameEndB = { id: 'bbb', endsAt: '2026-07-01T00:00:00.000Z' };
    expect(compareDiscoverablePromotions(earlier, later)).toBeLessThan(0);
    expect(compareDiscoverablePromotions(sameEndA, sameEndB)).toBeLessThan(0);
  });

  it('normalizes optional customer labels', () => {
    expect(normalizeCustomerLabel('  Offre Spéciale  ')).toBe('Offre Spéciale');
    expect(normalizeCustomerLabel('   ')).toBeNull();
    expect(normalizeCustomerLabel(null)).toBeNull();
  });
});
