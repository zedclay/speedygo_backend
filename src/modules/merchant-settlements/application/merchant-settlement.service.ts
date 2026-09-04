import { Injectable } from '@nestjs/common';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { FinancialLedgerService } from '../../financial-ledger/application/financial-ledger.service';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  merchantSettlementAdminRequired,
  merchantSettlementDraftExists,
  merchantSettlementFinancialStateInvalid,
  merchantSettlementInvalidState,
  merchantSettlementMerchantMismatch,
  merchantSettlementNotFound,
  merchantSettlementRefundAdjustmentExists,
  merchantSettlementRefundNotEligible,
  merchantSettlementSaleRequired,
} from '../domain/merchant-settlement.errors';
import {
  buildRefundAdjustmentAmounts,
  buildSaleLineAmounts,
  deriveSettlementTotals,
  isInstantInSettlementPeriod,
  isRefundEligibleForAdjustment,
  isSaleEligibleOrder,
  refundReference,
  requireDraftStatus,
  requireMerchantLiabilityMinor,
  requireValidSettlementPeriod,
} from '../domain/merchant-settlement.policy';
import {
  SETTLEMENT_CURRENCY_DZD,
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
  SETTLEMENT_LINE_TYPE_SALE,
  SETTLEMENT_STATUS_FINALIZED,
  type MerchantSettlementDetailView,
  type MerchantSettlementLineRecord,
  type MerchantSettlementLineView,
  type MerchantSettlementRecord,
  type MerchantSettlementSummaryView,
} from '../domain/merchant-settlement.types';
import {
  MerchantSettlementRepository,
  type OrmClient,
} from '../infrastructure/merchant-settlement.repository';

@Injectable()
export class MerchantSettlementService {
  constructor(
    private readonly settlements: MerchantSettlementRepository,
    private readonly access: MerchantAccessService,
    private readonly ledger: FinancialLedgerService,
    private readonly notifications: NotificationService,
  ) {}

  private async requireAdmin(adminId: string): Promise<void> {
    if (!(await this.settlements.adminExists(adminId))) {
      throw merchantSettlementAdminRequired();
    }
  }

  /**
   * Opens a DRAFT settlement batch for [periodStart, periodEnd).
   * At most one DRAFT per Merchant.
   */
  async openDraft(input: {
    merchantId: string;
    periodStart: string;
    periodEnd: string;
    adminId: string;
  }): Promise<MerchantSettlementRecord> {
    return this.settlements.runInTransaction((tx) =>
      this.openDraftInTx(tx, input),
    );
  }

  async openDraftInTx(
    tx: OrmClient,
    input: {
      merchantId: string;
      periodStart: string;
      periodEnd: string;
      adminId: string;
    },
  ): Promise<MerchantSettlementRecord> {
    await this.requireAdmin(input.adminId);
    requireValidSettlementPeriod(input.periodStart, input.periodEnd);
    if (!(await this.settlements.merchantExists(input.merchantId))) {
      throw merchantSettlementNotFound();
    }

    await this.settlements.lockMerchantScope(input.merchantId, tx);
    const existing = await this.settlements.findOpenDraft(input.merchantId, tx);
    if (existing) {
      throw merchantSettlementDraftExists();
    }
    return this.settlements.createDraft(
      {
        merchantId: input.merchantId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
      tx,
    );
  }

  /**
   * Adds missing SALE lines for COMPLETED + Payment SUCCEEDED Orders
   * with completedAt in the settlement period. Zero merchantNet is allowed.
   */
  async buildSaleLines(input: {
    settlementId: string;
    adminId: string;
  }): Promise<{ added: number; settlementId: string }> {
    return this.settlements.runInTransaction((tx) =>
      this.buildSaleLinesInTx(tx, input),
    );
  }

  async buildSaleLinesInTx(
    tx: OrmClient,
    input: {
      settlementId: string;
      adminId: string;
    },
  ): Promise<{ added: number; settlementId: string }> {
    await this.requireAdmin(input.adminId);

    const settlement = await this.settlements.findById(input.settlementId, tx);
    if (!settlement) {
      throw merchantSettlementNotFound();
    }
    requireDraftStatus(settlement.status);
    await this.settlements.lockMerchantScope(settlement.merchantId, tx);

    const eligible = await this.settlements.findEligibleSaleOrders(
      {
        merchantId: settlement.merchantId,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
      },
      tx,
    );

    let added = 0;
    for (const order of eligible) {
      if (
        !isSaleEligibleOrder({
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          completedAt: order.completedAt,
        })
      ) {
        continue;
      }
      const existing = await this.settlements.findSaleLineByOrderId(
        order.orderId,
        tx,
      );
      if (existing) {
        continue;
      }
      const amounts = buildSaleLineAmounts({
        grossMerchandiseSubtotalMinor: order.grossMerchandiseSubtotalMinor,
        merchantCommissionAmountMinor: order.merchantCommissionAmountMinor,
        merchantNetAmountMinor: order.merchantNetAmountMinor,
      });
      await this.settlements.createLine(
        {
          settlementId: settlement.id,
          orderId: order.orderId,
          type: SETTLEMENT_LINE_TYPE_SALE,
          ...amounts,
          reference: null,
        },
        tx,
      );
      added += 1;
    }

    if (added > 0) {
      await this.refreshDraftTotals(settlement.id, tx);
    }
    return { added, settlementId: settlement.id };
  }

  /**
   * Trusted adjudication: attach REFUND_ADJUSTMENT for a REFUNDED Refund.
   * liability 0 → no line. Requires SALE line for the Order (auto-adds SALE
   * into this DRAFT if still missing and Order is sale-eligible).
   */
  async attachRefundAdjustment(input: {
    settlementId: string;
    refundId: string;
    merchantLiabilityMinor: number;
    adminId: string;
  }): Promise<MerchantSettlementLineRecord | null> {
    return this.settlements.runInTransaction((tx) =>
      this.attachRefundAdjustmentInTx(tx, input),
    );
  }

  async attachRefundAdjustmentInTx(
    tx: OrmClient,
    input: {
      settlementId: string;
      refundId: string;
      merchantLiabilityMinor: number;
      adminId: string;
    },
  ): Promise<MerchantSettlementLineRecord | null> {
    await this.requireAdmin(input.adminId);

    const settlement = await this.settlements.findById(input.settlementId, tx);
    if (!settlement) {
      throw merchantSettlementNotFound();
    }
    requireDraftStatus(settlement.status);
    await this.settlements.lockMerchantScope(settlement.merchantId, tx);

    const refund = await this.settlements.findRefundSettlementContext(
      input.refundId,
      tx,
    );
    if (!refund) {
      throw merchantSettlementRefundNotEligible('Refund not found');
    }
    if (refund.merchantId !== settlement.merchantId) {
      throw merchantSettlementMerchantMismatch();
    }
    if (
      !isRefundEligibleForAdjustment({
        refundStatus: refund.status,
        completedAt: refund.completedAt,
      })
    ) {
      throw merchantSettlementRefundNotEligible(
        'Only REFUNDED Refunds with completedAt may create REFUND_ADJUSTMENT',
      );
    }
    if (
      !refund.completedAt ||
      !isInstantInSettlementPeriod(
        refund.completedAt,
        settlement.periodStart,
        settlement.periodEnd,
      )
    ) {
      throw merchantSettlementRefundNotEligible(
        'Refund.completedAt must fall in the settlement period [start, end)',
      );
    }

    const liability = requireMerchantLiabilityMinor(
      input.merchantLiabilityMinor,
      refund.amountMinor,
    );
    if (liability === 0) {
      return null;
    }

    const existingAdj = await this.settlements.findRefundAdjustmentByRefundId(
      refund.refundId,
      tx,
    );
    if (existingAdj) {
      throw merchantSettlementRefundAdjustmentExists();
    }

    let sale = await this.settlements.findSaleLineByOrderId(refund.orderId, tx);
    if (!sale) {
      const orderCtx = await this.settlements.findOrderSettlementContext(
        refund.orderId,
        tx,
      );
      if (
        !orderCtx ||
        !isSaleEligibleOrder({
          orderStatus: orderCtx.orderStatus,
          paymentStatus: orderCtx.paymentStatus,
          completedAt: orderCtx.completedAt,
        })
      ) {
        throw merchantSettlementSaleRequired();
      }
      if (orderCtx.merchantId !== settlement.merchantId) {
        throw merchantSettlementMerchantMismatch();
      }
      const amounts = buildSaleLineAmounts({
        grossMerchandiseSubtotalMinor: orderCtx.grossMerchandiseSubtotalMinor,
        merchantCommissionAmountMinor: orderCtx.merchantCommissionAmountMinor,
        merchantNetAmountMinor: orderCtx.merchantNetAmountMinor,
      });
      sale = await this.settlements.createLine(
        {
          settlementId: settlement.id,
          orderId: refund.orderId,
          type: SETTLEMENT_LINE_TYPE_SALE,
          ...amounts,
          reference: null,
        },
        tx,
      );
    }

    const adj = buildRefundAdjustmentAmounts(liability);
    const line = await this.settlements.createLine(
      {
        settlementId: settlement.id,
        orderId: refund.orderId,
        type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
        ...adj,
        reference: refundReference(refund.refundId),
      },
      tx,
    );
    await this.refreshDraftTotals(settlement.id, tx);
    return line;
  }

  private async refreshDraftTotals(
    settlementId: string,
    tx: OrmClient,
  ): Promise<void> {
    const lines = await this.settlements.listLines(settlementId, tx);
    const totals = deriveSettlementTotals(lines);
    await this.settlements.updateDraftTotals(settlementId, totals, tx);
  }

  async finalize(input: {
    settlementId: string;
    adminId: string;
  }): Promise<MerchantSettlementRecord> {
    const settlement = await this.settlements.runInTransaction((tx) =>
      this.finalizeInTx(tx, input),
    );
    await this.notifications.notifySettlementFinalized({
      settlementId: settlement.id,
      merchantId: settlement.merchantId,
    });
    return settlement;
  }

  async finalizeInTx(
    tx: OrmClient,
    input: {
      settlementId: string;
      adminId: string;
    },
  ): Promise<MerchantSettlementRecord> {
    await this.requireAdmin(input.adminId);

    const current = await this.settlements.findById(input.settlementId, tx);
    if (!current) {
      throw merchantSettlementNotFound();
    }
    if (current.status === SETTLEMENT_STATUS_FINALIZED) {
      await this.ledger.postMerchantSettlementFinalized(
        {
          settlementId: current.id,
          merchantId: current.merchantId,
          netPayableMinor: current.netPayableMinor,
        },
        tx,
      );
      return current;
    }
    requireDraftStatus(current.status);
    await this.settlements.lockMerchantScope(current.merchantId, tx);

    const fresh = await this.settlements.findById(input.settlementId, tx);
    if (!fresh) {
      throw merchantSettlementNotFound();
    }
    if (fresh.status === SETTLEMENT_STATUS_FINALIZED) {
      await this.ledger.postMerchantSettlementFinalized(
        {
          settlementId: fresh.id,
          merchantId: fresh.merchantId,
          netPayableMinor: fresh.netPayableMinor,
        },
        tx,
      );
      return fresh;
    }
    requireDraftStatus(fresh.status);

    const lines = await this.settlements.listLines(input.settlementId, tx);
    const totals = deriveSettlementTotals(lines);
    if (totals.grossSalesMinor < 0 || totals.commissionMinor < 0) {
      throw merchantSettlementFinancialStateInvalid(
        'Settlement gross/commission totals cannot be negative',
      );
    }

    const finalized = await this.settlements.finalize(
      input.settlementId,
      totals,
      tx,
    );
    if (!finalized || finalized.status !== SETTLEMENT_STATUS_FINALIZED) {
      throw merchantSettlementInvalidState(
        'Concurrent finalization prevented this action',
      );
    }
    await this.ledger.postMerchantSettlementFinalized(
      {
        settlementId: finalized.id,
        merchantId: finalized.merchantId,
        netPayableMinor: finalized.netPayableMinor,
      },
      tx,
    );
    return finalized;
  }

  async listMerchantSettlements(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantSettlementSummaryView[]> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.SETTLEMENT_READ,
    );
    const rows = await this.settlements.listByMerchant(merchantId);
    return rows.map(toSummaryView);
  }

  async getMerchantSettlement(
    accountId: string,
    merchantId: string,
    settlementId: string,
  ): Promise<MerchantSettlementDetailView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.SETTLEMENT_READ,
    );
    const settlement = await this.settlements.findById(settlementId);
    if (!settlement || settlement.merchantId !== merchantId) {
      throw merchantSettlementNotFound();
    }
    const lines = await this.settlements.listLines(settlementId);
    return {
      ...toSummaryView(settlement),
      lines: lines.map(toLineView),
    };
  }
}

function toSummaryView(
  row: MerchantSettlementRecord,
): MerchantSettlementSummaryView {
  return {
    settlementId: row.id,
    merchantId: row.merchantId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    currency: SETTLEMENT_CURRENCY_DZD,
    grossSalesMinor: row.grossSalesMinor,
    commissionMinor: row.commissionMinor,
    refundAdjustmentTotalMinor: row.refundAdjustmentsMinor,
    netPayableMinor: row.netPayableMinor,
    createdAt: row.createdAt,
  };
}

function toLineView(
  row: MerchantSettlementLineRecord,
): MerchantSettlementLineView {
  return {
    lineId: row.id,
    type: row.type,
    orderId: row.orderId,
    refundId:
      row.type === SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT
        ? row.reference
        : null,
    grossMerchandiseMinor: row.grossMerchandiseMinor,
    commissionMinor: row.commissionMinor,
    merchantNetMinor: row.merchantNetMinor,
    adjustmentMinor: row.adjustmentMinor,
    createdAt: row.createdAt,
  };
}
