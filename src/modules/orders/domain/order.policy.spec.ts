import { CART_ERROR_CODES } from '../../cart/domain/cart.errors';
import type { CartProductSnapshot } from '../../cart/domain/cart.types';
import { CHECKOUT_ERROR_CODES } from '../../checkout/domain/checkout.errors';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';
import { ORDER_ERROR_CODES } from './order.errors';
import {
  addMinorUnits,
  buildOrderFinancialSnapshot,
  commissionAmountMinor,
  merchandiseSubtotalMinor,
  parseOrderPaymentMethod,
  priceOrderLine,
  requireConfirmedAmountsMatch,
  requireCustomerConfirmedAmounts,
  inspectMerchantWorkflowTransition,
  merchantPreparationPaymentReady,
  selectApplicableCommissionRule,
  selectOrderPricingRule,
  subtractMinorUnits,
} from './order.policy';
import type { OrderCommissionRuleRecord } from './order.types';

function snapshot(
  overrides: Partial<CartProductSnapshot> = {},
): CartProductSnapshot {
  return {
    productId: 'product-1',
    name: 'Coffee',
    merchantId: 'merchant-1',
    merchantBranchId: 'branch-1',
    categoryId: 'category-1',
    categoryActive: true,
    productAvailable: true,
    livePriceMinor: 1000,
    merchantStatus: 'ACTIVE',
    merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
    merchantName: 'Cafe',
    branchOperationalStatus: 'ACTIVE',
    merchantOperationalReady: true,
    groups: [{ id: 'g1', required: true, minSelections: 1, maxSelections: 1 }],
    options: [
      {
        id: 'o-large',
        optionGroupId: 'g1',
        name: 'Large',
        available: true,
        additionalPriceMinor: 200,
      },
    ],
    ...overrides,
  };
}

function pricing(
  overrides: Partial<CheckoutPricingRuleRecord> = {},
): CheckoutPricingRuleRecord {
  return {
    id: 'rule-1',
    zoneId: 'zone-1',
    name: 'All day',
    timeBand: 'DAY',
    startLocalTime: null,
    endLocalTime: null,
    customerDeliveryFeeMinor: 500,
    driverRemunerationMinor: 300,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    active: true,
    ...overrides,
  };
}

function commission(
  overrides: Partial<OrderCommissionRuleRecord> = {},
): OrderCommissionRuleRecord {
  return {
    id: 'comm-global',
    scope: 'GLOBAL_DEFAULT',
    merchantId: null,
    rateBps: 700,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    active: true,
    ...overrides,
  };
}

describe('Order policy', () => {
  it('accepts COD and ELECTRONIC only', () => {
    expect(parseOrderPaymentMethod('COD')).toBe('COD');
    expect(parseOrderPaymentMethod('ELECTRONIC')).toBe('ELECTRONIC');
    try {
      parseOrderPaymentMethod('CARD');
      throw new Error('expected ORDER_PAYMENT_METHOD_INVALID');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_PAYMENT_METHOD_INVALID,
      );
    }
  });

  it('uses live Product and Option prices, not a stale Cart unit price', () => {
    const line = priceOrderLine({
      snapshot: snapshot({ livePriceMinor: 1500 }),
      quantity: 2,
      selectedOptionIds: ['o-large'],
    });
    expect(line.unitPriceMinor).toBe(1700);
    expect(line.lineTotalMinor).toBe(3400);
    expect(line.productNameSnapshot).toBe('Coffee');
    expect(line.options).toEqual([
      { optionNameSnapshot: 'Large', additionalPriceMinor: 200 },
    ]);
  });

  it('allows a zero-priced Product', () => {
    const line = priceOrderLine({
      snapshot: snapshot({
        livePriceMinor: 0,
        groups: [],
        options: [],
      }),
      quantity: 1,
      selectedOptionIds: [],
    });
    expect(line.unitPriceMinor).toBe(0);
    expect(line.lineTotalMinor).toBe(0);
  });

  it('rejects unavailable required options as cart-not-ready', () => {
    try {
      priceOrderLine({
        snapshot: snapshot({
          options: [
            {
              id: 'o-large',
              optionGroupId: 'g1',
              name: 'Large',
              available: false,
              additionalPriceMinor: 200,
            },
          ],
        }),
        quantity: 1,
        selectedOptionIds: ['o-large'],
      });
      throw new Error('expected ORDER_CART_NOT_READY');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_CART_NOT_READY,
      );
      expect((error as { code: string }).code).not.toBe(
        CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE,
      );
    }
  });

  it('protects money addition and subtraction overflow/underflow', () => {
    expect(addMinorUnits(1200, 500)).toBe(1700);
    expect(() => addMinorUnits(-1, 1)).toThrow();
    expect(subtractMinorUnits(500, 300)).toBe(200);
    try {
      subtractMinorUnits(300, 500);
      throw new Error('expected ORDER_FINANCIAL_CONFIGURATION_INVALID');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
  });

  it('computes commission with integer floor and overflow protection', () => {
    expect(commissionAmountMinor(1200, 700)).toBe(84);
    expect(commissionAmountMinor(1, 700)).toBe(0);
    expect(commissionAmountMinor(10000, 10000)).toBe(10000);
    try {
      commissionAmountMinor(1200, 10001);
      throw new Error('expected ORDER_FINANCIAL_CONFIGURATION_INVALID');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
  });

  it('prefers an applicable merchant override over the global default', () => {
    const instant = new Date('2026-01-15T10:00:00.000Z');
    const selected = selectApplicableCommissionRule(
      [
        commission(),
        commission({
          id: 'comm-override',
          scope: 'MERCHANT_OVERRIDE',
          merchantId: 'merchant-1',
          rateBps: 500,
        }),
      ],
      'merchant-1',
      instant,
    );
    expect(selected.id).toBe('comm-override');
    expect(selected.rateBps).toBe(500);
  });

  it('fails closed when no commission rule or overlapping rules apply', () => {
    const instant = new Date('2026-01-15T10:00:00.000Z');
    try {
      selectApplicableCommissionRule([], 'merchant-1', instant);
      throw new Error('expected missing commission rule');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
    try {
      selectApplicableCommissionRule(
        [commission({ id: 'g1' }), commission({ id: 'g2' })],
        'merchant-1',
        instant,
      );
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
  });

  it('ignores expired or future commission rules', () => {
    const instant = new Date('2026-01-15T10:00:00.000Z');
    const selected = selectApplicableCommissionRule(
      [
        commission({
          id: 'future',
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        }),
        commission({
          id: 'expired',
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: '2025-01-01T00:00:00.000Z',
        }),
        commission({ id: 'current' }),
      ],
      'merchant-1',
      instant,
    );
    expect(selected.id).toBe('current');
  });

  it('maps Checkout pricing configuration failures onto ORDER codes', () => {
    const instant = new Date('2026-01-15T10:00:00.000Z');
    try {
      selectOrderPricingRule([], instant);
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_PRICING_RULE_NOT_FOUND,
      );
    }
    try {
      selectOrderPricingRule(
        [
          pricing({
            id: 'a',
            startLocalTime: '08:00:00',
            endLocalTime: '18:00:00',
          }),
          pricing({
            id: 'b',
            startLocalTime: '08:00:00',
            endLocalTime: '18:00:00',
          }),
        ],
        instant,
      );
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_PRICING_CONFIGURATION_INVALID,
      );
      expect((error as { code: string }).code).not.toBe(
        CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
      );
    }
    try {
      selectOrderPricingRule(
        [pricing({ startLocalTime: '08:00:00', endLocalTime: null })],
        instant,
      );
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_PRICING_CONFIGURATION_INVALID,
      );
    }
  });

  it('builds a v1.0 financial snapshot without fake unresolved zeros for commission', () => {
    const line = priceOrderLine({
      snapshot: snapshot(),
      quantity: 1,
      selectedOptionIds: ['o-large'],
    });
    const financial = buildOrderFinancialSnapshot({
      grossMerchandiseSubtotalMinor: merchandiseSubtotalMinor([line]),
      customerDeliveryFeeMinor: 500,
      driverRemunerationMinor: 300,
      merchantCommissionRateBps: 700,
      commissionRuleId: 'comm-global',
      pricingRuleId: 'rule-1',
    });
    expect(financial.currency).toBe('DZD');
    expect(financial.grossMerchandiseSubtotalMinor).toBe(1200);
    expect(financial.merchantDiscountMinor).toBe(0);
    expect(financial.platformDiscountMinor).toBe(0);
    expect(financial.totalDiscountMinor).toBe(0);
    expect(financial.commissionBaseMinor).toBe(1200);
    expect(financial.merchantCommissionAmountMinor).toBe(84);
    expect(financial.merchantNetAmountMinor).toBe(1116);
    expect(financial.customerDeliveryFeeMinor).toBe(500);
    expect(financial.driverRemunerationMinor).toBe(300);
    expect(financial.speedyGoDeliveryShareMinor).toBe(200);
    expect(financial.serviceFeeMinor).toBe(0);
    expect(financial.customerPayableMinor).toBe(1700);
  });

  it('does not include Customer delivery fee in Merchant commission', () => {
    const base = {
      grossMerchandiseSubtotalMinor: 1200,
      driverRemunerationMinor: 300,
      merchantCommissionRateBps: 700,
      commissionRuleId: 'comm-global',
      pricingRuleId: 'rule-1',
    };
    const withLowerFee = buildOrderFinancialSnapshot({
      ...base,
      customerDeliveryFeeMinor: 500,
    });
    const withHigherFee = buildOrderFinancialSnapshot({
      ...base,
      customerDeliveryFeeMinor: 900,
      driverRemunerationMinor: 300,
    });
    expect(withLowerFee.merchantCommissionAmountMinor).toBe(84);
    expect(withHigherFee.merchantCommissionAmountMinor).toBe(84);
    expect(withLowerFee.merchantNetAmountMinor).toBe(
      withHigherFee.merchantNetAmountMinor,
    );
  });

  it('maps merchant-funded discount into merchantDiscount without reducing commission base', () => {
    const financial = buildOrderFinancialSnapshot({
      grossMerchandiseSubtotalMinor: 10000,
      customerDeliveryFeeMinor: 500,
      driverRemunerationMinor: 300,
      merchantCommissionRateBps: 1000,
      commissionRuleId: 'comm-global',
      pricingRuleId: 'rule-1',
      merchantDiscountMinor: 2000,
      platformDiscountMinor: 0,
    });
    expect(financial.commissionBaseMinor).toBe(10000);
    expect(financial.merchantCommissionAmountMinor).toBe(1000);
    expect(financial.merchantDiscountMinor).toBe(2000);
    expect(financial.platformDiscountMinor).toBe(0);
    expect(financial.merchantNetAmountMinor).toBe(7000);
    expect(financial.customerPayableMinor).toBe(8500);
    expect(financial.driverRemunerationMinor).toBe(300);
  });

  it('maps SpeedyGo-funded discount into platformDiscount without reducing Merchant net', () => {
    const financial = buildOrderFinancialSnapshot({
      grossMerchandiseSubtotalMinor: 10000,
      customerDeliveryFeeMinor: 500,
      driverRemunerationMinor: 300,
      merchantCommissionRateBps: 1000,
      commissionRuleId: 'comm-global',
      pricingRuleId: 'rule-1',
      merchantDiscountMinor: 0,
      platformDiscountMinor: 2000,
    });
    expect(financial.commissionBaseMinor).toBe(10000);
    expect(financial.merchantCommissionAmountMinor).toBe(1000);
    expect(financial.merchantDiscountMinor).toBe(0);
    expect(financial.platformDiscountMinor).toBe(2000);
    expect(financial.merchantNetAmountMinor).toBe(9000);
    expect(financial.customerPayableMinor).toBe(8500);
  });

  it('rejects merchant-funded discount that would make Merchant net negative', () => {
    try {
      buildOrderFinancialSnapshot({
        grossMerchandiseSubtotalMinor: 10000,
        customerDeliveryFeeMinor: 500,
        driverRemunerationMinor: 300,
        merchantCommissionRateBps: 700,
        commissionRuleId: 'comm-global',
        pricingRuleId: 'rule-1',
        merchantDiscountMinor: 10000,
        platformDiscountMinor: 0,
      });
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
  });

  it('rejects a Delivery Fee lower than driver remuneration', () => {
    try {
      buildOrderFinancialSnapshot({
        grossMerchandiseSubtotalMinor: 1000,
        customerDeliveryFeeMinor: 100,
        driverRemunerationMinor: 200,
        merchantCommissionRateBps: 0,
        commissionRuleId: 'comm-global',
        pricingRuleId: 'rule-1',
      });
      fail('expected');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      );
    }
  });

  it('accepts internally consistent Customer-confirmed expected amounts', () => {
    expect(
      requireCustomerConfirmedAmounts({
        expectedMerchandiseSubtotalMinor: 1200,
        expectedDeliveryFeeMinor: 500,
        expectedCustomerTotalMinor: 1700,
      }),
    ).toEqual({
      expectedMerchandiseSubtotalMinor: 1200,
      expectedDeliveryFeeMinor: 500,
      expectedCustomerTotalMinor: 1700,
    });
  });

  it('accepts expected totals that omit additive equality (promotion-aware)', () => {
    expect(
      requireCustomerConfirmedAmounts({
        expectedMerchandiseSubtotalMinor: 1200,
        expectedDeliveryFeeMinor: 500,
        expectedCustomerTotalMinor: 1600,
      }),
    ).toEqual({
      expectedMerchandiseSubtotalMinor: 1200,
      expectedDeliveryFeeMinor: 500,
      expectedCustomerTotalMinor: 1600,
    });
  });

  it('rejects negative, fractional, and unsafe expected amounts', () => {
    try {
      requireCustomerConfirmedAmounts({
        expectedMerchandiseSubtotalMinor: -1,
        expectedDeliveryFeeMinor: 0,
        expectedCustomerTotalMinor: -1,
      });
      fail('expected negative');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID,
      );
    }
    try {
      requireCustomerConfirmedAmounts({
        expectedMerchandiseSubtotalMinor: 1.5,
        expectedDeliveryFeeMinor: 0,
        expectedCustomerTotalMinor: 1.5,
      });
      fail('expected fractional');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID,
      );
    }
    try {
      requireCustomerConfirmedAmounts({
        expectedMerchandiseSubtotalMinor: Number.MAX_SAFE_INTEGER,
        expectedDeliveryFeeMinor: 0,
        expectedCustomerTotalMinor: Number.MAX_SAFE_INTEGER,
      });
      fail('expected unsafe');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID,
      );
    }
  });

  it('requires reconfirmation when live amounts differ from expected amounts', () => {
    try {
      requireConfirmedAmountsMatch({
        grossMerchandiseSubtotalMinor: 1500,
        deliveryFeeMinor: 800,
        customerPayableMinor: 2300,
        expectedMerchandiseSubtotalMinor: 1200,
        expectedDeliveryFeeMinor: 500,
        expectedCustomerTotalMinor: 1700,
      });
      fail('expected reconfirmation');
    } catch (error) {
      expect((error as { code: string; details?: unknown }).code).toBe(
        ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED,
      );
      expect((error as { details: unknown }).details).toEqual({
        changes: ['MERCHANDISE', 'DELIVERY_FEE', 'CUSTOMER_TOTAL'],
        current: {
          merchandiseSubtotalMinor: 1500,
          deliveryFeeMinor: 800,
          customerTotalMinor: 2300,
        },
      });
    }
  });

  it('does not treat expected amounts as price authority when they match', () => {
    expect(() =>
      requireConfirmedAmountsMatch({
        grossMerchandiseSubtotalMinor: 1200,
        deliveryFeeMinor: 500,
        customerPayableMinor: 1700,
        expectedMerchandiseSubtotalMinor: 1200,
        expectedDeliveryFeeMinor: 500,
        expectedCustomerTotalMinor: 1700,
      }),
    ).not.toThrow();
  });

  it('inspects Merchant workflow transitions without collapsing Order and Fulfillment', () => {
    expect(
      inspectMerchantWorkflowTransition(
        'ACCEPT',
        'CREATED',
        'PENDING_ACCEPTANCE',
      ),
    ).toBe('APPLY');
    expect(
      inspectMerchantWorkflowTransition('ACCEPT', 'CONFIRMED', 'ACCEPTED'),
    ).toBe('ALREADY_ACCEPTED');
    expect(
      inspectMerchantWorkflowTransition(
        'START_PREPARATION',
        'CREATED',
        'PENDING_ACCEPTANCE',
      ),
    ).toBe('INVALID');
    expect(
      inspectMerchantWorkflowTransition(
        'START_PREPARATION',
        'CONFIRMED',
        'ACCEPTED',
      ),
    ).toBe('APPLY');
    expect(
      inspectMerchantWorkflowTransition('MARK_READY', 'CONFIRMED', 'ACCEPTED'),
    ).toBe('INVALID');
    expect(
      inspectMerchantWorkflowTransition('MARK_READY', 'CONFIRMED', 'PREPARING'),
    ).toBe('INVALID');
    expect(
      inspectMerchantWorkflowTransition('MARK_READY', 'ACTIVE', 'PREPARING'),
    ).toBe('APPLY');
    expect(
      inspectMerchantWorkflowTransition('ACCEPT', 'CANCELLED', 'ACCEPTED'),
    ).toBe('INVALID');
    expect(
      inspectMerchantWorkflowTransition('MARK_READY', 'COMPLETED', 'READY'),
    ).toBe('INVALID');
    expect(
      inspectMerchantWorkflowTransition(
        'REJECT',
        'CREATED',
        'PENDING_ACCEPTANCE',
      ),
    ).toBe('APPLY');
    expect(
      inspectMerchantWorkflowTransition('REJECT', 'CONFIRMED', 'ACCEPTED'),
    ).toBe('NOT_REJECTABLE');
    expect(
      inspectMerchantWorkflowTransition(
        'REJECT',
        'CANCELLED',
        'PENDING_ACCEPTANCE',
      ),
    ).toBe('NOT_REJECTABLE');
  });

  it('gates ELECTRONIC preparation on SUCCEEDED payment and allows COD PENDING', () => {
    expect(merchantPreparationPaymentReady('COD', 'PENDING')).toBe(true);
    expect(merchantPreparationPaymentReady('ELECTRONIC', 'PENDING')).toBe(
      false,
    );
    expect(merchantPreparationPaymentReady('ELECTRONIC', 'SUCCEEDED')).toBe(
      true,
    );
    expect(merchantPreparationPaymentReady('ELECTRONIC', 'FAILED')).toBe(false);
    expect(merchantPreparationPaymentReady('ELECTRONIC', 'CANCELLED')).toBe(
      false,
    );
    expect(merchantPreparationPaymentReady('COD', 'FAILED')).toBe(false);
  });
});
