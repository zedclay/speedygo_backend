import {
  buildRefundAdjustmentAmounts,
  buildSaleLineAmounts,
  deriveSettlementTotals,
  isInstantInSettlementPeriod,
  isRefundEligibleForAdjustment,
  isSaleEligibleOrder,
  requireMerchantLiabilityMinor,
  requireValidSettlementPeriod,
} from './merchant-settlement.policy';
import { MERCHANT_SETTLEMENT_ERROR_CODES } from './merchant-settlement.errors';
import {
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
  SETTLEMENT_LINE_TYPE_SALE,
} from './merchant-settlement.types';

describe('merchant-settlement.policy', () => {
  describe('period', () => {
    it('uses half-open [start, end)', () => {
      expect(
        isInstantInSettlementPeriod(
          '2026-02-01T00:00:00.000Z',
          '2026-02-01T00:00:00.000Z',
          '2026-03-01T00:00:00.000Z',
        ),
      ).toBe(true);
      expect(
        isInstantInSettlementPeriod(
          '2026-03-01T00:00:00.000Z',
          '2026-02-01T00:00:00.000Z',
          '2026-03-01T00:00:00.000Z',
        ),
      ).toBe(false);
    });

    it('rejects invalid period', () => {
      try {
        requireValidSettlementPeriod(
          '2026-03-01T00:00:00.000Z',
          '2026-02-01T00:00:00.000Z',
        );
        fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_PERIOD_INVALID,
        });
      }
    });
  });

  describe('SALE eligibility', () => {
    it('accepts COMPLETED + SUCCEEDED with completedAt', () => {
      expect(
        isSaleEligibleOrder({
          orderStatus: 'COMPLETED',
          paymentStatus: 'SUCCEEDED',
          completedAt: '2026-02-10T12:00:00.000Z',
        }),
      ).toBe(true);
    });

    it.each(['CREATED', 'CONFIRMED', 'ACTIVE', 'CANCELLED', 'FAILED'])(
      'rejects %s',
      (orderStatus) => {
        expect(
          isSaleEligibleOrder({
            orderStatus,
            paymentStatus: 'SUCCEEDED',
            completedAt: '2026-02-10T12:00:00.000Z',
          }),
        ).toBe(false);
      },
    );
  });

  describe('SALE amount authority', () => {
    it('copies immutable snapshot amounts and rejects negative net', () => {
      expect(
        buildSaleLineAmounts({
          grossMerchandiseSubtotalMinor: 10000,
          merchantCommissionAmountMinor: 700,
          merchantNetAmountMinor: 9300,
        }),
      ).toEqual({
        grossMerchandiseMinor: 10000,
        commissionMinor: 700,
        merchantNetMinor: 9300,
        adjustmentMinor: 0,
      });
      try {
        buildSaleLineAmounts({
          grossMerchandiseSubtotalMinor: 1000,
          merchantCommissionAmountMinor: 0,
          merchantNetAmountMinor: -1,
        });
        fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_LIABILITY_INVALID,
        });
      }
    });

    it('allows zero merchant net SALE', () => {
      expect(
        buildSaleLineAmounts({
          grossMerchandiseSubtotalMinor: 0,
          merchantCommissionAmountMinor: 0,
          merchantNetAmountMinor: 0,
        }).merchantNetMinor,
      ).toBe(0);
    });
  });

  describe('refund liability', () => {
    it('only REFUNDED with completedAt is eligible', () => {
      expect(
        isRefundEligibleForAdjustment({
          refundStatus: 'REFUNDED',
          completedAt: '2026-02-11T00:00:00.000Z',
        }),
      ).toBe(true);
      expect(
        isRefundEligibleForAdjustment({
          refundStatus: 'APPROVED',
          completedAt: null,
        }),
      ).toBe(false);
      expect(
        isRefundEligibleForAdjustment({
          refundStatus: 'REQUESTED',
          completedAt: null,
        }),
      ).toBe(false);
    });

    it('bounds merchantLiabilityMinor to [0, refund]', () => {
      expect(requireMerchantLiabilityMinor(2500, 4000)).toBe(2500);
      expect(requireMerchantLiabilityMinor(0, 4000)).toBe(0);
      try {
        requireMerchantLiabilityMinor(-1, 4000);
        fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_LIABILITY_INVALID,
        });
      }
      try {
        requireMerchantLiabilityMinor(4001, 4000);
        fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_LIABILITY_INVALID,
        });
      }
    });

    it('uses negative signed adjustmentMinor', () => {
      expect(buildRefundAdjustmentAmounts(2000)).toEqual({
        grossMerchandiseMinor: 0,
        commissionMinor: 0,
        merchantNetMinor: 0,
        adjustmentMinor: -2000,
      });
    });
  });

  describe('totals', () => {
    it('derives net from SALE nets + signed adjustments', () => {
      const totals = deriveSettlementTotals([
        {
          type: SETTLEMENT_LINE_TYPE_SALE,
          grossMerchandiseMinor: 10000,
          commissionMinor: 700,
          merchantNetMinor: 8000,
          adjustmentMinor: 0,
        },
        {
          type: SETTLEMENT_LINE_TYPE_SALE,
          grossMerchandiseMinor: 6000,
          commissionMinor: 420,
          merchantNetMinor: 5000,
          adjustmentMinor: 0,
        },
        {
          type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
          grossMerchandiseMinor: 0,
          commissionMinor: 0,
          merchantNetMinor: 0,
          adjustmentMinor: -2000,
        },
      ]);
      expect(totals.grossSalesMinor).toBe(16000);
      expect(totals.commissionMinor).toBe(1120);
      expect(totals.refundAdjustmentsMinor).toBe(-2000);
      expect(totals.manualAdjustmentsMinor).toBe(0);
      expect(totals.netPayableMinor).toBe(11000);
    });

    it('allows negative net payable', () => {
      const totals = deriveSettlementTotals([
        {
          type: SETTLEMENT_LINE_TYPE_SALE,
          grossMerchandiseMinor: 5000,
          commissionMinor: 0,
          merchantNetMinor: 5000,
          adjustmentMinor: 0,
        },
        {
          type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
          grossMerchandiseMinor: 0,
          commissionMinor: 0,
          merchantNetMinor: 0,
          adjustmentMinor: -7000,
        },
      ]);
      expect(totals.netPayableMinor).toBe(-2000);
    });
  });
});
