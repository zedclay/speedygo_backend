import {
  loadPromotionDomainValue,
  persistPromotionMoneyFields,
  promotionValueAmountDzd,
} from './promotion-money-storage';
import {
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
} from '../domain/promotion.types';

describe('promotion money storage boundary', () => {
  const prev = process.env['MONEY_PRISMA_DECIMAL'];

  afterEach(() => {
    if (prev === undefined) {
      delete process.env['MONEY_PRISMA_DECIMAL'];
    } else {
      process.env['MONEY_PRISMA_DECIMAL'] = prev;
    }
  });

  it('shared BigInt runtime writes INT value for FIXED and RATE', () => {
    delete process.env['MONEY_PRISMA_DECIMAL'];
    expect(
      persistPromotionMoneyFields(PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR, 25000),
    ).toEqual({ value: 25000 });
    expect(
      persistPromotionMoneyFields(PROMOTION_TYPE_SPEEDYGO_RATE_BPS, 700),
    ).toEqual({ value: 700 });
  });

  it('Decimal runtime stores FIXED as NUMERIC DZD and RATE as integer bps', () => {
    process.env['MONEY_PRISMA_DECIMAL'] = '1';
    expect(
      persistPromotionMoneyFields(PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR, 25000),
    ).toEqual({
      value: null,
      valueAmount: '250.00',
    });
    expect(
      persistPromotionMoneyFields(PROMOTION_TYPE_SPEEDYGO_RATE_BPS, 700),
    ).toEqual({ value: 700, valueAmount: null });
  });

  it('loads FIXED from valueAmount and RATE from integer value', () => {
    process.env['MONEY_PRISMA_DECIMAL'] = '1';
    expect(
      loadPromotionDomainValue({
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: null,
        valueAmount: '250.00',
      }),
    ).toBe(25000);
    expect(
      loadPromotionDomainValue({
        type: PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
        value: 700,
        valueAmount: null,
      }),
    ).toBe(700);
  });

  it('v1 25000 centimes ≡ v2 "250.00" DZD for FIXED', () => {
    expect(
      promotionValueAmountDzd(PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR, 25000),
    ).toBe('250.00');
    expect(promotionValueAmountDzd(PROMOTION_TYPE_SPEEDYGO_RATE_BPS, 700)).toBe(
      null,
    );
  });
});
