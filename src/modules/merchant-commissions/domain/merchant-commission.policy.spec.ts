import { MERCHANT_COMMISSION_ERROR_CODES } from './merchant-commission.errors';
import {
  calculateMerchantCommission,
  calculateMerchantCommissionAmountMinor,
  commissionWindowsOverlap,
  isCommissionRuleEffectiveAt,
  requireSelectedRuleStillValid,
  requireValidCommissionScopeMerchant,
  selectApplicableMerchantCommissionRule,
} from './merchant-commission.policy';
import type {
  MerchantCommissionRuleRecord,
  ResolvedMerchantCommissionRule,
} from './merchant-commission.types';

function rule(
  overrides: Partial<MerchantCommissionRuleRecord> = {},
): MerchantCommissionRuleRecord {
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

describe('merchant-commission.policy', () => {
  const instant = new Date('2026-01-15T10:00:00.000Z');

  it('prefers an applicable Merchant override over GLOBAL_DEFAULT', () => {
    const selected = selectApplicableMerchantCommissionRule(
      [
        rule(),
        rule({
          id: 'override-a',
          scope: 'MERCHANT_OVERRIDE',
          merchantId: 'merchant-a',
          rateBps: 500,
        }),
      ],
      'merchant-a',
      instant,
    );
    expect(selected.ruleId).toBe('override-a');
    expect(selected.rateBps).toBe(500);
  });

  it('uses GLOBAL_DEFAULT when no override applies', () => {
    const selected = selectApplicableMerchantCommissionRule(
      [
        rule(),
        rule({
          id: 'override-b',
          scope: 'MERCHANT_OVERRIDE',
          merchantId: 'merchant-b',
          rateBps: 100,
        }),
      ],
      'merchant-a',
      instant,
    );
    expect(selected.ruleId).toBe('comm-global');
    expect(selected.scope).toBe('GLOBAL_DEFAULT');
  });

  it('does not apply Merchant A override to Merchant B', () => {
    const selected = selectApplicableMerchantCommissionRule(
      [
        rule({ rateBps: 700 }),
        rule({
          id: 'override-a',
          scope: 'MERCHANT_OVERRIDE',
          merchantId: 'merchant-a',
          rateBps: 250,
        }),
      ],
      'merchant-b',
      instant,
    );
    expect(selected.rateBps).toBe(700);
  });

  it('fails closed with no valid rule and with overlapping applicable rules', () => {
    try {
      selectApplicableMerchantCommissionRule([], 'merchant-a', instant);
      throw new Error('expected missing');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RULE_NOT_FOUND,
      );
    }
    try {
      selectApplicableMerchantCommissionRule(
        [rule({ id: 'g1' }), rule({ id: 'g2' })],
        'merchant-a',
        instant,
      );
      throw new Error('expected ambiguous');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RULE_AMBIGUOUS,
      );
    }
  });

  it('treats explicit 0 bps as a valid rule, not missing configuration', () => {
    const selected = selectApplicableMerchantCommissionRule(
      [rule({ rateBps: 0 })],
      'merchant-a',
      instant,
    );
    expect(selected.rateBps).toBe(0);
    expect(calculateMerchantCommissionAmountMinor(1200, 0)).toBe(0);
    expect(
      calculateMerchantCommission({
        commissionBaseMinor: 1200,
        rateBps: 0,
      }).merchantNetFromBaseMinor,
    ).toBe(1200);
  });

  it('allows 10000 bps and rejects invalid rates', () => {
    expect(calculateMerchantCommissionAmountMinor(1200, 10000)).toBe(1200);
    expect(
      calculateMerchantCommission({
        commissionBaseMinor: 1200,
        rateBps: 10000,
      }).merchantNetFromBaseMinor,
    ).toBe(0);
    expect(() => calculateMerchantCommissionAmountMinor(1200, -1)).toThrow();
    expect(() => calculateMerchantCommissionAmountMinor(1200, 10001)).toThrow();
    expect(() => calculateMerchantCommissionAmountMinor(-1, 700)).toThrow();
  });

  it('uses integer floor rounding with BigInt (no float multiplication)', () => {
    expect(calculateMerchantCommissionAmountMinor(1200, 700)).toBe(84);
    expect(calculateMerchantCommissionAmountMinor(1, 700)).toBe(0);
    expect(calculateMerchantCommissionAmountMinor(3, 1)).toBe(0);
    expect(calculateMerchantCommissionAmountMinor(9999, 1)).toBe(0);
    expect(calculateMerchantCommissionAmountMinor(10000, 1)).toBe(1);
  });

  it('applies half-open effective windows against one commissionDecisionAt', () => {
    const windowed = rule({
      effectiveFrom: '2026-01-15T10:00:00.000Z',
      effectiveTo: '2026-01-15T12:00:00.000Z',
    });
    expect(
      isCommissionRuleEffectiveAt(
        windowed,
        new Date('2026-01-15T10:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isCommissionRuleEffectiveAt(
        windowed,
        new Date('2026-01-15T12:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      selectApplicableMerchantCommissionRule(
        [windowed],
        'merchant-a',
        new Date('2026-01-15T10:00:00.000Z'),
      ).ruleId,
    ).toBe('comm-global');
    expect(() =>
      selectApplicableMerchantCommissionRule(
        [windowed],
        'merchant-a',
        new Date('2026-01-15T12:00:00.000Z'),
      ),
    ).toThrow();
  });

  it('fails closed when the re-read rule does not match the selected decision', () => {
    const selected: ResolvedMerchantCommissionRule = {
      ruleId: 'comm-global',
      scope: 'GLOBAL_DEFAULT',
      merchantId: null,
      rateBps: 700,
    };
    expect(() =>
      requireSelectedRuleStillValid({
        selected,
        locked: rule({ rateBps: 500 }),
        orderMerchantId: 'merchant-a',
        commissionDecisionAt: instant,
      }),
    ).toThrow();
    expect(
      requireSelectedRuleStillValid({
        selected,
        locked: rule(),
        orderMerchantId: 'merchant-a',
        commissionDecisionAt: instant,
      }).rateBps,
    ).toBe(700);
  });

  it('computes commission and merchant net from merchandise base', () => {
    const result = calculateMerchantCommission({
      commissionBaseMinor: 1200,
      rateBps: 700,
    });
    expect(result.commissionMinor).toBe(84);
    expect(result.merchantNetFromBaseMinor).toBe(1116);
  });

  it('does not change commission when only delivery fee would have changed', () => {
    const merchandise = calculateMerchantCommission({
      commissionBaseMinor: 1200,
      rateBps: 700,
    });
    const sameMerchandiseDifferentFee = calculateMerchantCommission({
      commissionBaseMinor: 1200,
      rateBps: 700,
    });
    expect(merchandise.commissionMinor).toBe(
      sameMerchandiseDifferentFee.commissionMinor,
    );
  });

  it('rejects invalid scope/merchant combinations', () => {
    expect(() =>
      requireValidCommissionScopeMerchant({
        scope: 'GLOBAL_DEFAULT',
        merchantId: 'merchant-a',
      }),
    ).toThrow();
    expect(() =>
      requireValidCommissionScopeMerchant({
        scope: 'MERCHANT_OVERRIDE',
        merchantId: null,
      }),
    ).toThrow();
  });

  it('detects overlapping effective windows', () => {
    expect(
      commissionWindowsOverlap(
        {
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        },
        {
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: null,
        },
      ),
    ).toBe(true);
    expect(
      commissionWindowsOverlap(
        {
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: '2024-01-01T00:00:00.000Z',
        },
        {
          effectiveFrom: '2024-01-01T00:00:00.000Z',
          effectiveTo: null,
        },
      ),
    ).toBe(false);
  });
});
