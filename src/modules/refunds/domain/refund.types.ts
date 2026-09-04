export const REFUND_STATUS_REQUESTED = 'REQUESTED';
export const REFUND_STATUS_UNDER_REVIEW = 'UNDER_REVIEW';
export const REFUND_STATUS_APPROVED = 'APPROVED';
export const REFUND_STATUS_PROCESSING = 'PROCESSING';
export const REFUND_STATUS_REFUNDED = 'REFUNDED';
export const REFUND_STATUS_REJECTED = 'REJECTED';
export const REFUND_STATUS_FAILED = 'FAILED';

export const REFUND_STATUSES = [
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_PROCESSING,
  REFUND_STATUS_REFUNDED,
  REFUND_STATUS_REJECTED,
  REFUND_STATUS_FAILED,
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Statuses that still consume refundable capacity. */
export const REFUND_RESERVING_STATUSES: readonly RefundStatus[] = [
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_PROCESSING,
  REFUND_STATUS_REFUNDED,
];

/** Statuses that release previously reserved capacity. */
export const REFUND_RELEASED_STATUSES: readonly RefundStatus[] = [
  REFUND_STATUS_REJECTED,
  REFUND_STATUS_FAILED,
];

export const REFUND_METHOD_ORIGINAL_PAYMENT = 'ORIGINAL_PAYMENT';
export const REFUND_METHOD_MANUAL_COD = 'MANUAL_COD';
export const REFUND_METHOD_MANUAL_OTHER = 'MANUAL_OTHER';

export const REFUND_METHODS = [
  REFUND_METHOD_ORIGINAL_PAYMENT,
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
] as const;

export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_CURRENCY_DZD = 'DZD';

export const REFUND_EXECUTOR = Symbol('REFUND_EXECUTOR');

export type RefundRecord = {
  id: string;
  orderId: string;
  paymentTransactionId: string | null;
  refundMethod: RefundMethod;
  amountMinor: number;
  status: RefundStatus;
  reason: string;
  internalNote: string | null;
  requestedByAdminId: string;
  requestedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type RefundFinancialContext = {
  orderId: string;
  orderStatus: string;
  customerId: string;
  paymentId: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentAmountMinor: number;
  paymentCurrency: string;
  snapshotPayableMinor: number;
  snapshotCurrency: string;
};

export type RefundCapacitySummary = {
  originalPaidMinor: number;
  reservedRefundMinor: number;
  successfulRefundMinor: number;
  remainingRefundableMinor: number;
  currency: string;
};

export type CustomerRefundView = {
  refundId: string;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  method: RefundMethod;
  reason: string;
  requestedAt: string;
  completedAt: string | null;
};

export type CustomerOrderRefundsView = {
  orderId: string;
  originalPaidMinor: number;
  reservedRefundMinor: number;
  successfulRefundMinor: number;
  remainingRefundableMinor: number;
  currency: string;
  refunds: CustomerRefundView[];
};

export type ProviderRefundExecutionResult =
  | {
      supported: false;
      reason: string;
    }
  | {
      supported: true;
      providerReference: string;
    };

export interface RefundExecutor {
  executeOriginalPaymentRefund(input: {
    refundId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    paymentTransactionId: string;
    paymentProviderReference: string | null;
  }): Promise<ProviderRefundExecutionResult>;
}
