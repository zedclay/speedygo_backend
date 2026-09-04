import { MerchantSettlementService } from './merchant-settlement.service';
import { MERCHANT_SETTLEMENT_ERROR_CODES } from '../domain/merchant-settlement.errors';
import {
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
  SETTLEMENT_LINE_TYPE_SALE,
  SETTLEMENT_STATUS_DRAFT,
  SETTLEMENT_STATUS_FINALIZED,
} from '../domain/merchant-settlement.types';

const ADMIN = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const MERCHANT = 'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm';
const SETTLEMENT = 'ssssssss-ssss-7sss-8sss-ssssssssssss';
const ORDER = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';
const REFUND = 'rrrrrrrr-rrrr-7rrr-8rrr-rrrrrrrrrrrr';

describe('MerchantSettlementService', () => {
  let settlements: {
    adminExists: jest.Mock;
    merchantExists: jest.Mock;
    runInTransaction: jest.Mock;
    lockMerchantScope: jest.Mock;
    findOpenDraft: jest.Mock;
    createDraft: jest.Mock;
    findById: jest.Mock;
    findEligibleSaleOrders: jest.Mock;
    findSaleLineByOrderId: jest.Mock;
    createLine: jest.Mock;
    listLines: jest.Mock;
    updateDraftTotals: jest.Mock;
    finalize: jest.Mock;
    findRefundSettlementContext: jest.Mock;
    findRefundAdjustmentByRefundId: jest.Mock;
    findOrderSettlementContext: jest.Mock;
    listByMerchant: jest.Mock;
  };
  let access: { requireCapability: jest.Mock };
  let service: MerchantSettlementService;
  let tx: Record<string, never>;

  beforeEach(() => {
    tx = {};
    settlements = {
      adminExists: jest.fn().mockResolvedValue(true),
      merchantExists: jest.fn().mockResolvedValue(true),
      runInTransaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
      lockMerchantScope: jest.fn().mockResolvedValue(undefined),
      findOpenDraft: jest.fn().mockResolvedValue(null),
      createDraft: jest.fn().mockResolvedValue({
        id: SETTLEMENT,
        merchantId: MERCHANT,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-03-01T00:00:00.000Z',
        grossSalesMinor: 0,
        commissionMinor: 0,
        refundAdjustmentsMinor: 0,
        manualAdjustmentsMinor: 0,
        netPayableMinor: 0,
        status: SETTLEMENT_STATUS_DRAFT,
        paidAt: null,
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      findById: jest.fn().mockResolvedValue({
        id: SETTLEMENT,
        merchantId: MERCHANT,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-03-01T00:00:00.000Z',
        grossSalesMinor: 0,
        commissionMinor: 0,
        refundAdjustmentsMinor: 0,
        manualAdjustmentsMinor: 0,
        netPayableMinor: 0,
        status: SETTLEMENT_STATUS_DRAFT,
        paidAt: null,
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      findEligibleSaleOrders: jest.fn().mockResolvedValue([
        {
          orderId: ORDER,
          completedAt: '2026-02-10T12:00:00.000Z',
          orderStatus: 'COMPLETED',
          paymentStatus: 'SUCCEEDED',
          grossMerchandiseSubtotalMinor: 10000,
          merchantCommissionAmountMinor: 700,
          merchantNetAmountMinor: 9300,
        },
      ]),
      findSaleLineByOrderId: jest.fn().mockResolvedValue(null),
      createLine: jest
        .fn()
        .mockImplementation(
          (input: {
            settlementId: string;
            orderId: string | null;
            type: string;
            grossMerchandiseMinor: number;
            commissionMinor: number;
            merchantNetMinor: number;
            adjustmentMinor: number;
            reference: string | null;
          }) =>
            Promise.resolve({
              id: 'line-1',
              settlementId: input.settlementId,
              orderId: input.orderId,
              type: input.type,
              grossMerchandiseMinor: input.grossMerchandiseMinor,
              commissionMinor: input.commissionMinor,
              merchantNetMinor: input.merchantNetMinor,
              adjustmentMinor: input.adjustmentMinor,
              reference: input.reference,
              createdAt: '2026-02-10T12:00:00.000Z',
            }),
        ),
      listLines: jest.fn().mockResolvedValue([]),
      updateDraftTotals: jest.fn().mockResolvedValue(undefined),
      finalize: jest.fn().mockResolvedValue({
        id: SETTLEMENT,
        merchantId: MERCHANT,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-03-01T00:00:00.000Z',
        grossSalesMinor: 10000,
        commissionMinor: 700,
        refundAdjustmentsMinor: 0,
        manualAdjustmentsMinor: 0,
        netPayableMinor: 9300,
        status: SETTLEMENT_STATUS_FINALIZED,
        paidAt: null,
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      findRefundSettlementContext: jest.fn().mockResolvedValue({
        refundId: REFUND,
        orderId: ORDER,
        status: 'REFUNDED',
        amountMinor: 4000,
        completedAt: '2026-02-15T00:00:00.000Z',
        merchantId: MERCHANT,
      }),
      findRefundAdjustmentByRefundId: jest.fn().mockResolvedValue(null),
      findOrderSettlementContext: jest.fn().mockResolvedValue({
        orderId: ORDER,
        merchantId: MERCHANT,
        orderStatus: 'COMPLETED',
        completedAt: '2026-02-10T12:00:00.000Z',
        paymentStatus: 'SUCCEEDED',
        grossMerchandiseSubtotalMinor: 10000,
        merchantCommissionAmountMinor: 700,
        merchantNetAmountMinor: 9300,
      }),
      listByMerchant: jest.fn().mockResolvedValue([]),
    };
    access = { requireCapability: jest.fn().mockResolvedValue({}) };
    service = new MerchantSettlementService(
      settlements as never,
      access as never,
    );
  });

  it('builds SALE from immutable snapshot merchant net', async () => {
    const result = await service.buildSaleLines({
      settlementId: SETTLEMENT,
      adminId: ADMIN,
    });
    expect(result.added).toBe(1);
    expect(settlements.createLine).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SETTLEMENT_LINE_TYPE_SALE,
        orderId: ORDER,
        merchantNetMinor: 9300,
        adjustmentMinor: 0,
      }),
      tx,
    );
    expect(settlements.updateDraftTotals).toHaveBeenCalled();
  });

  it('skips Orders that already have a SALE line', async () => {
    settlements.findSaleLineByOrderId.mockResolvedValue({
      id: 'existing',
      type: SETTLEMENT_LINE_TYPE_SALE,
    });
    const result = await service.buildSaleLines({
      settlementId: SETTLEMENT,
      adminId: ADMIN,
    });
    expect(result.added).toBe(0);
    expect(settlements.createLine).not.toHaveBeenCalled();
  });

  it('attaches trusted liability as negative REFUND_ADJUSTMENT', async () => {
    settlements.findSaleLineByOrderId.mockResolvedValue({
      id: 'sale',
      type: SETTLEMENT_LINE_TYPE_SALE,
      orderId: ORDER,
    });
    settlements.listLines.mockResolvedValue([
      {
        type: SETTLEMENT_LINE_TYPE_SALE,
        grossMerchandiseMinor: 10000,
        commissionMinor: 700,
        merchantNetMinor: 9300,
        adjustmentMinor: 0,
      },
      {
        type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
        grossMerchandiseMinor: 0,
        commissionMinor: 0,
        merchantNetMinor: 0,
        adjustmentMinor: -2500,
      },
    ]);
    const line = await service.attachRefundAdjustment({
      settlementId: SETTLEMENT,
      refundId: REFUND,
      merchantLiabilityMinor: 2500,
      adminId: ADMIN,
    });
    expect(line?.adjustmentMinor).toBe(-2500);
    expect(settlements.createLine).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
        adjustmentMinor: -2500,
        reference: REFUND,
      }),
      tx,
    );
  });

  it('returns null and creates no line when liability is zero', async () => {
    const line = await service.attachRefundAdjustment({
      settlementId: SETTLEMENT,
      refundId: REFUND,
      merchantLiabilityMinor: 0,
      adminId: ADMIN,
    });
    expect(line).toBeNull();
    expect(settlements.createLine).not.toHaveBeenCalled();
  });

  it('rejects liability above Refund.amountMinor', async () => {
    await expect(
      service.attachRefundAdjustment({
        settlementId: SETTLEMENT,
        refundId: REFUND,
        merchantLiabilityMinor: 4001,
        adminId: ADMIN,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_LIABILITY_INVALID,
    });
  });

  it('rejects non-REFUNDED Refund adjustment', async () => {
    settlements.findRefundSettlementContext.mockResolvedValue({
      refundId: REFUND,
      orderId: ORDER,
      status: 'APPROVED',
      amountMinor: 4000,
      completedAt: null,
      merchantId: MERCHANT,
    });
    await expect(
      service.attachRefundAdjustment({
        settlementId: SETTLEMENT,
        refundId: REFUND,
        merchantLiabilityMinor: 1000,
        adminId: ADMIN,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_REFUND_NOT_ELIGIBLE,
    });
  });

  it('finalizes with derived totals and never sets paidAt', async () => {
    settlements.listLines.mockResolvedValue([
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
    const finalized = await service.finalize({
      settlementId: SETTLEMENT,
      adminId: ADMIN,
    });
    expect(settlements.finalize).toHaveBeenCalledWith(
      SETTLEMENT,
      expect.objectContaining({ netPayableMinor: 11000 }),
      tx,
    );
    expect(finalized.status).toBe(SETTLEMENT_STATUS_FINALIZED);
    expect(finalized.paidAt).toBeNull();
  });

  it('idempotent finalize when already FINALIZED', async () => {
    settlements.findById.mockResolvedValue({
      id: SETTLEMENT,
      merchantId: MERCHANT,
      periodStart: '2026-02-01T00:00:00.000Z',
      periodEnd: '2026-03-01T00:00:00.000Z',
      grossSalesMinor: 9300,
      commissionMinor: 700,
      refundAdjustmentsMinor: 0,
      manualAdjustmentsMinor: 0,
      netPayableMinor: 9300,
      status: SETTLEMENT_STATUS_FINALIZED,
      paidAt: null,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    const finalized = await service.finalize({
      settlementId: SETTLEMENT,
      adminId: ADMIN,
    });
    expect(finalized.status).toBe(SETTLEMENT_STATUS_FINALIZED);
    expect(settlements.finalize).not.toHaveBeenCalled();
  });
});
