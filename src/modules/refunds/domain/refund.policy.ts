import {
  ORDER_PAYMENT_METHOD_COD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_FAILED,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';
import {
  refundAmountInvalid,
  refundFinancialStateInvalid,
  refundInsufficientRemaining,
  refundMethodInvalid,
  refundOrderNotEligible,
  refundPaymentNotSucceeded,
  refundProviderUnsupported,
  refundReasonInvalid,
} from './refund.errors';
import {
  REFUND_CURRENCY_DZD,
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
  REFUND_METHOD_ORIGINAL_PAYMENT,
  REFUND_METHODS,
  REFUND_RELEASED_STATUSES,
  REFUND_RESERVING_STATUSES,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_FAILED,
  REFUND_STATUS_PROCESSING,
  REFUND_STATUS_REFUNDED,
  REFUND_STATUS_REJECTED,
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
  REFUND_STATUSES,
  type RefundCapacitySummary,
  type RefundMethod,
  type RefundStatus,
} from './refund.types';

export const REFUND_ELIGIBLE_ORDER_STATUSES = [
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
] as const;

export const REFUND_REASON_MAX_LENGTH = 255;

export const ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE =
  'ORIGINAL_PAYMENT is disabled in Refunds Foundation v1.0: no verified Chargily Refund API in the SpeedyGo provider contract';

export function isRefundStatus(value: string): value is RefundStatus {
  return (REFUND_STATUSES as readonly string[]).includes(value);
}

export function isRefundMethod(value: string): value is RefundMethod {
  return (REFUND_METHODS as readonly string[]).includes(value);
}

export function isReservingRefundStatus(status: string): boolean {
  return (REFUND_RESERVING_STATUSES as readonly string[]).includes(status);
}

export function isReleasedRefundStatus(status: string): boolean {
  return (REFUND_RELEASED_STATUSES as readonly string[]).includes(status);
}

export function isRefundEligibleOrderStatus(status: string): boolean {
  return (REFUND_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function requirePositiveRefundAmount(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw refundAmountInvalid();
  }
  return amountMinor;
}

export function requireRefundReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > REFUND_REASON_MAX_LENGTH) {
    throw refundReasonInvalid();
  }
  return trimmed;
}

export function requireSucceededPayment(status: string): void {
  if (status !== PAYMENT_STATUS_SUCCEEDED) {
    throw refundPaymentNotSucceeded();
  }
}

export function requireEligibleOrderStatus(status: string): void {
  if (!isRefundEligibleOrderStatus(status)) {
    throw refundOrderNotEligible(
      'Refund creation is limited to COMPLETED, CANCELLED, or FAILED Orders',
    );
  }
}

export function requirePaymentSnapshotConsistency(input: {
  paymentAmountMinor: number;
  snapshotPayableMinor: number;
  paymentCurrency: string;
  snapshotCurrency: string;
}): void {
  if (
    input.paymentCurrency !== REFUND_CURRENCY_DZD ||
    input.snapshotCurrency !== REFUND_CURRENCY_DZD
  ) {
    throw refundFinancialStateInvalid(
      'Refund requires DZD Payment and OrderFinancialSnapshot currency',
    );
  }
  if (input.paymentAmountMinor !== input.snapshotPayableMinor) {
    throw refundFinancialStateInvalid(
      'Payment.amountMinor must equal OrderFinancialSnapshot.customerPayableMinor',
    );
  }
  if (
    !Number.isInteger(input.paymentAmountMinor) ||
    input.paymentAmountMinor < 0
  ) {
    throw refundFinancialStateInvalid('Payment amount is invalid');
  }
}

export function calculateRefundCapacity(input: {
  originalPaidMinor: number;
  reservedRefundMinor: number;
  successfulRefundMinor: number;
  currency?: string;
}): RefundCapacitySummary {
  const remaining = input.originalPaidMinor - input.reservedRefundMinor;
  return {
    originalPaidMinor: input.originalPaidMinor,
    reservedRefundMinor: input.reservedRefundMinor,
    successfulRefundMinor: input.successfulRefundMinor,
    remainingRefundableMinor: remaining < 0 ? 0 : remaining,
    currency: input.currency ?? REFUND_CURRENCY_DZD,
  };
}

export function requireRefundableAmount(
  amountMinor: number,
  remainingRefundableMinor: number,
): void {
  requirePositiveRefundAmount(amountMinor);
  if (amountMinor > remainingRefundableMinor) {
    throw refundInsufficientRemaining();
  }
}

/**
 * Refunds Foundation v1.0 executable method mapping (FINAL):
 * - COD Payment → MANUAL_COD only
 * - ELECTRONIC Payment → MANUAL_OTHER only
 * - ORIGINAL_PAYMENT → disabled (no verified Chargily Refund API)
 *
 * paymentTransactionId must be null for both manual methods.
 */
export function resolveRefundMethodBinding(input: {
  refundMethod: string;
  paymentMethod: string;
  paymentTransactionId: string | null;
}): {
  refundMethod: RefundMethod;
  paymentTransactionId: null;
} {
  if (!isRefundMethod(input.refundMethod)) {
    throw refundMethodInvalid('Unsupported Refund method');
  }

  if (input.refundMethod === REFUND_METHOD_ORIGINAL_PAYMENT) {
    throw refundProviderUnsupported(ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE);
  }

  if (input.paymentTransactionId !== null) {
    throw refundMethodInvalid(
      'v1.0 manual Refunds must not reference a PaymentTransaction',
    );
  }

  if (input.paymentMethod === ORDER_PAYMENT_METHOD_COD) {
    if (input.refundMethod !== REFUND_METHOD_MANUAL_COD) {
      throw refundMethodInvalid(
        'COD Payments require refundMethod MANUAL_COD in Refunds v1.0',
      );
    }
    return {
      refundMethod: REFUND_METHOD_MANUAL_COD,
      paymentTransactionId: null,
    };
  }

  if (input.paymentMethod === ORDER_PAYMENT_METHOD_ELECTRONIC) {
    if (input.refundMethod !== REFUND_METHOD_MANUAL_OTHER) {
      throw refundMethodInvalid(
        'ELECTRONIC Payments require refundMethod MANUAL_OTHER in Refunds v1.0',
      );
    }
    return {
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      paymentTransactionId: null,
    };
  }

  throw refundMethodInvalid('Payment method is not refundable in Refunds v1.0');
}

export function canMarkUnderReview(status: RefundStatus): boolean {
  return status === REFUND_STATUS_REQUESTED;
}

export function canAuthorizeRefund(status: RefundStatus): boolean {
  return (
    status === REFUND_STATUS_REQUESTED || status === REFUND_STATUS_UNDER_REVIEW
  );
}

export function canRejectRefund(status: RefundStatus): boolean {
  return (
    status === REFUND_STATUS_REQUESTED || status === REFUND_STATUS_UNDER_REVIEW
  );
}

/** Manual confirmation is APPROVED → REFUNDED only (PROCESSING reserved for future provider). */
export function canConfirmManualRefund(
  status: RefundStatus,
  method: RefundMethod,
): boolean {
  if (
    method !== REFUND_METHOD_MANUAL_COD &&
    method !== REFUND_METHOD_MANUAL_OTHER
  ) {
    return false;
  }
  return status === REFUND_STATUS_APPROVED;
}

/**
 * FAILED is for an actual attempted execution failure (future provider / aborted attempt).
 * Never use FAILED merely because a method is unsupported.
 */
export function canFailRefund(status: RefundStatus): boolean {
  return (
    status === REFUND_STATUS_APPROVED || status === REFUND_STATUS_PROCESSING
  );
}

export function nextUnderReviewStatus(): RefundStatus {
  return REFUND_STATUS_UNDER_REVIEW;
}

export function nextAuthorizedStatus(): RefundStatus {
  return REFUND_STATUS_APPROVED;
}

export function nextRejectedStatus(): RefundStatus {
  return REFUND_STATUS_REJECTED;
}

export function nextProcessingStatus(): RefundStatus {
  return REFUND_STATUS_PROCESSING;
}

export function nextRefundedStatus(): RefundStatus {
  return REFUND_STATUS_REFUNDED;
}

export function nextFailedStatus(): RefundStatus {
  return REFUND_STATUS_FAILED;
}

export function isManualExecutableMethod(method: RefundMethod): boolean {
  return (
    method === REFUND_METHOD_MANUAL_COD || method === REFUND_METHOD_MANUAL_OTHER
  );
}
