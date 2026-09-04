export type ReportWindowMeta = {
  from: string;
  to: string;
  interval: '[from, to)';
  timezone: 'UTC_INSTANTS';
};

export type OrdersOperationsReportDto = {
  window: ReportWindowMeta;
  ordersCreatedCount: number;
  ordersCompletedCount: number;
  ordersCancelledCount: number;
  ordersFailedCount: number;
  ordersCreatedByStatus: Record<string, number>;
};

export type DeliveriesOperationsReportDto = {
  window: ReportWindowMeta;
  deliveriesDeliveredCount: number;
};

export type SupportOperationsReportDto = {
  window: ReportWindowMeta;
  ticketsCreatedCount: number;
  ticketsCreatedByStatus: Record<string, number>;
  ticketsCreatedByPriority: Record<string, number>;
};

export type RatingsOperationsReportDto = {
  window: ReportWindowMeta;
  /** Ratings created in window (DriverRating + MerchantRating rows). */
  driverRatingsCreatedCount: number;
  merchantRatingsCreatedCount: number;
  driverRatingScoreSum: number;
  merchantRatingScoreSum: number;
  driverRatingAverage: number | null;
  merchantRatingAverage: number | null;
};

export type CompletedOrdersFinanceReportDto = {
  window: ReportWindowMeta;
  /** Cohort: Order.completedAt in [from,to) AND status COMPLETED. Values from OrderFinancialSnapshot only. */
  completedOrderCount: number;
  grossMerchandiseMinor: string;
  merchantCommissionMinor: string;
  merchantDiscountMinor: string;
  platformDiscountMinor: string;
  merchantNetMinor: string;
  customerDeliveryFeeMinor: string;
  driverRemunerationMinor: string;
  speedyGoDeliveryShareMinor: string;
  customerPayableMinor: string;
};

export type PaymentsFinanceReportDto = {
  window: ReportWindowMeta;
  /**
   * Payment.status = SUCCEEDED with authoritative success-event time in [from,to).
   * Event time (not Payment.updatedAt — lockPayment bumps updatedAt after SUCCEEDED):
   * - ELECTRONIC: MIN(PaymentTransaction.processedAt) where transaction status = SUCCEEDED
   * - COD: CodCollection.collectedAt (atomic with Payment → SUCCEEDED; no PaymentTransaction)
   * Amount: Payment.amountMinor once per Payment (not sum of attempt rows).
   */
  paymentSucceededDuringPeriodCount: number;
  customerPaymentSucceededDuringPeriodMinor: string;
  successEventSource: 'PAYMENT_TRANSACTION_PROCESSED_AT_OR_COD_COLLECTED_AT';
};

export type RefundsFinanceReportDto = {
  window: ReportWindowMeta;
  /** Refund.status = REFUNDED and Refund.completedAt in [from,to). */
  refundCompletedCount: number;
  customerRefundedMinor: string;
};

export type CodFinanceReportDto = {
  window: ReportWindowMeta;
  /** FLOW: CodCollection.collectedAt in [from,to). Custody, not earnings. */
  codCollectedDuringPeriodCount: number;
  codCollectedDuringPeriodMinor: string;
  /** FLOW: CodRemittance CONFIRMED with confirmedAt in [from,to). */
  codConfirmedRemittedDuringPeriodCount: number;
  codConfirmedRemittedDuringPeriodMinor: string;
  /**
   * FLOW convenience: period collections − period confirmed remittance amounts.
   * Not outstanding custody / not a balance.
   */
  codCustodyNetMovementDuringPeriodMinor: string;
  /**
   * POSITION as-of exclusive end `to` (history before `to`, not reset at `from`):
   * SUM(COLLECTED with collectedAt < to) − SUM(allocations on CONFIRMED remittances with confirmedAt < to).
   */
  codOutstandingCustodyAsOfToMinor: string;
  /** FLOW: CodDiscrepancy.createdAt in window (created atomically with confirmation when amounts differ). */
  codDiscrepancyCreatedDuringPeriodCount: number;
  codDiscrepancyDifferenceDuringPeriodMinorSum: string;
};

export type DriverEarningsFinanceReportDto = {
  window: ReportWindowMeta;
  /**
   * DriverEarning.createdAt in window.
   * Frozen domain creates the EARNED row atomically when Delivery becomes DELIVERED.
   * EARNED = earned/unpaid — not payout time.
   */
  driverEarningRowCount: number;
  driverEarnedMinor: string;
};

export type SettlementsFinanceReportDto = {
  window: ReportWindowMeta;
  /**
   * Creation cohort only: MerchantSettlement.createdAt in [from,to).
   * No finalizedAt exists; DRAFT→FINALIZED is a later lifecycle event.
   * *Currently*Finalized* = current status classification of that creation cohort —
   * NOT a finalization-event cohort.
   */
  settlementsCreatedDuringPeriodCount: number;
  settlementsCreatedCurrentlyDraftCount: number;
  settlementsCreatedCurrentlyFinalizedCount: number;
  settlementsCreatedCurrentlyFinalizedNetPayableMinor: string;
};

export type PromotionsFinanceReportDto = {
  window: ReportWindowMeta;
  /** Completed Orders in window; discount components from OrderFinancialSnapshot. */
  completedOrderCount: number;
  merchantFundedDiscountMinor: string;
  platformFundedDiscountMinor: string;
};

export type MerchantFinanceListItemDto = {
  merchantId: string;
  completedOrderCount: number;
  grossMerchandiseMinor: string;
  merchantCommissionMinor: string;
  merchantNetMinor: string;
};

export type MerchantFinanceListReportDto = {
  window: ReportWindowMeta;
  items: MerchantFinanceListItemDto[];
  total: number;
  limit: number;
  offset: number;
};

export type DriverOperationsListItemDto = {
  driverId: string;
  completedDeliveryCount: number;
};

export type DriverOperationsListReportDto = {
  window: ReportWindowMeta;
  items: DriverOperationsListItemDto[];
  total: number;
  limit: number;
  offset: number;
};
