import { createHash } from 'node:crypto';
import {
  ORDER_STATUS_COMPLETED,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';
import { REFUND_STATUS_REFUNDED } from '../../refunds/domain/refund.types';
import {
  merchantSettlementInvalidState,
  merchantSettlementLiabilityInvalid,
  merchantSettlementPeriodInvalid,
} from './merchant-settlement.errors';
import {
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
  SETTLEMENT_LINE_TYPE_SALE,
  SETTLEMENT_STATUS_DRAFT,
  SETTLEMENT_STATUS_FINALIZED,
  type MerchantSettlementLineRecord,
  type SettlementStatus,
  type SettlementTotals,
} from './merchant-settlement.types';

/** Advisory lock class id: 'SGST' */
export const MERCHANT_SETTLEMENT_LOCK_CLASS_ID = 0x53475354;

export function merchantSettlementAdvisoryObjectId(merchantId: string): number {
  const digest = createHash('sha256').update(merchantId).digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}

export function isSettlementStatus(value: string): value is SettlementStatus {
  return (
    value === SETTLEMENT_STATUS_DRAFT || value === SETTLEMENT_STATUS_FINALIZED
  );
}

export function requireDraftStatus(status: string): void {
  if (status !== SETTLEMENT_STATUS_DRAFT) {
    throw merchantSettlementInvalidState(
      'Only DRAFT settlements can be mutated',
    );
  }
}

/**
 * Half-open period: periodStart <= eventAt < periodEnd.
 */
export function isInstantInSettlementPeriod(
  eventAt: string,
  periodStart: string,
  periodEnd: string,
): boolean {
  return eventAt >= periodStart && eventAt < periodEnd;
}

export function requireValidSettlementPeriod(
  periodStart: string,
  periodEnd: string,
): void {
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw merchantSettlementPeriodInvalid(
      'periodEnd must be strictly after periodStart',
    );
  }
}

export function isSaleEligibleOrder(input: {
  orderStatus: string;
  paymentStatus: string;
  completedAt: string | null;
}): boolean {
  return (
    input.orderStatus === ORDER_STATUS_COMPLETED &&
    input.paymentStatus === PAYMENT_STATUS_SUCCEEDED &&
    input.completedAt != null &&
    input.completedAt.length > 0
  );
}

export function isRefundEligibleForAdjustment(input: {
  refundStatus: string;
  completedAt: string | null;
}): boolean {
  return (
    input.refundStatus === REFUND_STATUS_REFUNDED &&
    input.completedAt != null &&
    input.completedAt.length > 0
  );
}

/**
 * Trusted Merchant liability for a Customer Refund.
 * 0 <= liability <= Refund.amountMinor
 */
export function requireMerchantLiabilityMinor(
  merchantLiabilityMinor: number,
  refundAmountMinor: number | bigint,
): bigint {
  const refund = BigInt(refundAmountMinor);
  if (
    !Number.isInteger(merchantLiabilityMinor) ||
    merchantLiabilityMinor < 0 ||
    refund <= 0n
  ) {
    throw merchantSettlementLiabilityInvalid();
  }
  const liability = BigInt(merchantLiabilityMinor);
  if (liability > refund) {
    throw merchantSettlementLiabilityInvalid(
      'Merchant liability cannot exceed Refund.amountMinor',
    );
  }
  return liability;
}

export function buildSaleLineAmounts(snapshot: {
  grossMerchandiseSubtotalMinor: number | bigint;
  merchantCommissionAmountMinor: number | bigint;
  merchantNetAmountMinor: number | bigint;
}): {
  grossMerchandiseMinor: bigint;
  commissionMinor: bigint;
  merchantNetMinor: bigint;
  adjustmentMinor: bigint;
} {
  const grossMerchandiseMinor = BigInt(snapshot.grossMerchandiseSubtotalMinor);
  const commissionMinor = BigInt(snapshot.merchantCommissionAmountMinor);
  const merchantNetMinor = BigInt(snapshot.merchantNetAmountMinor);
  if (
    grossMerchandiseMinor < 0n ||
    commissionMinor < 0n ||
    merchantNetMinor < 0n
  ) {
    throw merchantSettlementLiabilityInvalid(
      'OrderFinancialSnapshot Merchant sale amounts are invalid',
    );
  }
  return {
    grossMerchandiseMinor,
    commissionMinor,
    merchantNetMinor,
    adjustmentMinor: 0n,
  };
}

/**
 * REFUND_ADJUSTMENT sign convention (FINAL):
 * adjustmentMinor = -merchantLiabilityMinor (debit against Merchant payable)
 * merchantNetMinor = 0
 */
export function buildRefundAdjustmentAmounts(
  merchantLiabilityMinor: number | bigint,
): {
  grossMerchandiseMinor: bigint;
  commissionMinor: bigint;
  merchantNetMinor: bigint;
  adjustmentMinor: bigint;
} {
  const liability = BigInt(merchantLiabilityMinor);
  return {
    grossMerchandiseMinor: 0n,
    commissionMinor: 0n,
    merchantNetMinor: 0n,
    adjustmentMinor: -liability,
  };
}

export function deriveSettlementTotals(
  lines: Array<
    Pick<
      MerchantSettlementLineRecord,
      | 'type'
      | 'grossMerchandiseMinor'
      | 'commissionMinor'
      | 'merchantNetMinor'
      | 'adjustmentMinor'
    >
  >,
): SettlementTotals {
  let grossSalesMinor = 0n;
  let commissionMinor = 0n;
  let refundAdjustmentsMinor = 0n;
  let saleNets = 0n;
  let adjustments = 0n;

  for (const line of lines) {
    if (line.type === SETTLEMENT_LINE_TYPE_SALE) {
      grossSalesMinor += line.grossMerchandiseMinor;
      commissionMinor += line.commissionMinor;
      saleNets += line.merchantNetMinor;
    } else if (line.type === SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT) {
      refundAdjustmentsMinor += line.adjustmentMinor;
      adjustments += line.adjustmentMinor;
    } else {
      adjustments += line.adjustmentMinor;
    }
  }

  return {
    grossSalesMinor,
    commissionMinor,
    refundAdjustmentsMinor,
    manualAdjustmentsMinor: 0n,
    netPayableMinor: saleNets + adjustments,
  };
}

export function refundReference(refundId: string): string {
  return refundId;
}
