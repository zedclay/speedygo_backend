export const SETTLEMENT_STATUS_DRAFT = 'DRAFT';
export const SETTLEMENT_STATUS_FINALIZED = 'FINALIZED';

/** Application-frozen vocabulary (schema status is free VARCHAR). */
export const SETTLEMENT_STATUSES = [
  SETTLEMENT_STATUS_DRAFT,
  SETTLEMENT_STATUS_FINALIZED,
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_LINE_TYPE_SALE = 'SALE';
export const SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT = 'REFUND_ADJUSTMENT';

/** v1.0 uses only SALE and REFUND_ADJUSTMENT (schema also has MANUAL_ADJUSTMENT, REVERSAL). */
export const SETTLEMENT_LINE_TYPES_V1 = [
  SETTLEMENT_LINE_TYPE_SALE,
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
] as const;

export type SettlementLineTypeV1 = (typeof SETTLEMENT_LINE_TYPES_V1)[number];

export const SETTLEMENT_CURRENCY_DZD = 'DZD';

export type MerchantSettlementRecord = {
  id: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  grossSalesMinor: bigint;
  commissionMinor: bigint;
  refundAdjustmentsMinor: bigint;
  manualAdjustmentsMinor: bigint;
  netPayableMinor: bigint;
  status: SettlementStatus;
  paidAt: string | null;
  createdAt: string;
};

export type MerchantSettlementLineRecord = {
  id: string;
  settlementId: string;
  orderId: string | null;
  type: SettlementLineTypeV1;
  grossMerchandiseMinor: bigint;
  commissionMinor: bigint;
  merchantNetMinor: bigint;
  adjustmentMinor: bigint;
  reference: string | null;
  createdAt: string;
};

export type SettlementTotals = {
  grossSalesMinor: bigint;
  commissionMinor: bigint;
  refundAdjustmentsMinor: bigint;
  manualAdjustmentsMinor: bigint;
  netPayableMinor: bigint;
};

export type MerchantSettlementSummaryView = {
  settlementId: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  currency: string;
  grossSalesMinor: string;
  commissionMinor: string;
  refundAdjustmentTotalMinor: string;
  netPayableMinor: string;
  createdAt: string;
};

export type MerchantSettlementLineView = {
  lineId: string;
  type: SettlementLineTypeV1;
  orderId: string | null;
  refundId: string | null;
  grossMerchandiseMinor: string;
  commissionMinor: string;
  merchantNetMinor: string;
  adjustmentMinor: string;
  createdAt: string;
};

export type MerchantSettlementDetailView = MerchantSettlementSummaryView & {
  lines: MerchantSettlementLineView[];
};
