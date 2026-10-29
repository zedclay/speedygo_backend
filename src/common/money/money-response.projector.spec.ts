import { MONEY_CONTRACT_V1_MINOR, MONEY_CONTRACT_V2_DZD } from './money-contract';
import { projectMoneyPayload } from './money-response.projector';

describe('projectMoneyPayload', () => {
  const payload = {
    submittedAmountMinor: '65000',
    totalEarnedMinor: '15000',
    items: [{ amountMinor: '15000', currency: 'DZD' }],
  };

  it('leaves v1 payloads unchanged (*Minor remain centimes)', () => {
    expect(projectMoneyPayload(payload, MONEY_CONTRACT_V1_MINOR)).toEqual(
      payload,
    );
  });

  it('adds explicit DZD fields without rewriting *Minor', () => {
    const v2 = projectMoneyPayload(payload, MONEY_CONTRACT_V2_DZD) as {
      submittedAmountMinor: string;
      submittedAmount: string;
      totalEarned: string;
      items: Array<{ amountMinor: string; amount: string }>;
    };
    expect(v2.submittedAmountMinor).toBe('65000');
    expect(v2.submittedAmount).toBe('650.00');
    expect(v2.totalEarned).toBe('150.00');
    expect(v2.items[0].amountMinor).toBe('15000');
    expect(v2.items[0].amount).toBe('150.00');
  });

  it('does not invent money from unknown keys', () => {
    const v2 = projectMoneyPayload(
      { latitude: '36.75', count: 12 },
      MONEY_CONTRACT_V2_DZD,
    ) as Record<string, unknown>;
    expect(v2['latitude']).toBe('36.75');
    expect(v2['count']).toBe(12);
    expect(v2['amount']).toBeUndefined();
  });

  it('projects customer order discount without funding buckets or rewriting *Minor', () => {
    const order = {
      financial: {
        currency: 'DZD',
        merchandiseSubtotalMinor: '1400',
        deliveryFeeMinor: '500',
        discountMinor: '400',
        customerTotalMinor: '1500',
      },
    };
    expect(projectMoneyPayload(order, MONEY_CONTRACT_V1_MINOR)).toEqual(order);
    const v2 = projectMoneyPayload(order, MONEY_CONTRACT_V2_DZD) as {
      financial: {
        merchandiseSubtotalMinor: string;
        merchandiseSubtotal: string;
        discountMinor: string;
        discount: string;
        customerTotalMinor: string;
        customerTotal: string;
        merchantDiscount?: string;
        platformDiscount?: string;
        totalDiscount?: string;
      };
    };
    expect(v2.financial.discountMinor).toBe('400');
    expect(v2.financial.discount).toBe('4.00');
    expect(v2.financial.merchandiseSubtotalMinor).toBe('1400');
    expect(v2.financial.merchandiseSubtotal).toBe('14.00');
    expect(v2.financial.customerTotalMinor).toBe('1500');
    expect(v2.financial.customerTotal).toBe('15.00');
    expect(v2.financial.merchantDiscount).toBeUndefined();
    expect(v2.financial.platformDiscount).toBeUndefined();
    expect(v2.financial.totalDiscount).toBeUndefined();
  });

  it('projects 409 current discount and promo without changing *Minor scale', () => {
    const body = {
      error: {
        code: 'ORDER_RECONFIRMATION_REQUIRED',
        current: {
          merchandiseSubtotalMinor: '1500',
          deliveryFeeMinor: '500',
          discountMinor: '200',
          customerTotalMinor: '1800',
          promoCode: 'NEWCODE',
        },
      },
    };
    const v2 = projectMoneyPayload(body, MONEY_CONTRACT_V2_DZD) as {
      error: {
        current: {
          discountMinor: string;
          discount: string;
          customerTotalMinor: string;
          customerTotal: string;
          promoCode: string;
        };
      };
    };
    expect(v2.error.current.discountMinor).toBe('200');
    expect(v2.error.current.discount).toBe('2.00');
    expect(v2.error.current.customerTotalMinor).toBe('1800');
    expect(v2.error.current.customerTotal).toBe('18.00');
    expect(v2.error.current.promoCode).toBe('NEWCODE');
  });
});
