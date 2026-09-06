import {
  ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_CREATED,
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_PROCESSING,
  PAYMENT_STATUS_SUCCEEDED,
} from './order.policy';
import {
  orderCancellationNotAllowed,
  orderCancellationReasonInvalid,
} from './order.errors';

/** Max length for optional Customer cancellation reason (OrderCancellation.reason). */
export const CUSTOMER_CANCELLATION_REASON_MAX_LENGTH = 255;

export const ORDER_STATUS_EVENT_CUSTOMER_CANCELLED = 'CUSTOMER_CANCELLED';

/**
 * Stable human-readable Refund.reason values for paid-terminal intents.
 * Notes/reasons are metadata only — uniqueness uses paidTerminalIntentKey.
 */
export const PAID_TERMINAL_REASON_CUSTOMER_CANCEL =
  'Customer cancelled before Merchant acceptance; refund workflow required';
export const PAID_TERMINAL_REASON_MERCHANT_REJECT =
  'Merchant rejected before acceptance; refund workflow required';
export const PAID_TERMINAL_REASON_LATE_SUCCESS =
  'Late verified Payment success after Order terminal; refund workflow required';

function containsForbiddenReasonChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127 || value[i] === '<' || value[i] === '>') {
      return true;
    }
  }
  return false;
}

export type CustomerCancellationDecision =
  | 'APPLY'
  | 'IDEMPOTENT_CANCELLED'
  | 'DENIED_FULFILLMENT_STARTED'
  | 'DENIED_TERMINAL'
  | 'DENIED_STATE';

/**
 * v1.0 Customer self-cancellation window:
 * Order.status=CREATED and fulfillmentStatus=PENDING_ACCEPTANCE only.
 * Already CANCELLED → idempotent reuse (same owner).
 */
export function inspectCustomerCancellation(
  status: string,
  fulfillmentStatus: string,
): CustomerCancellationDecision {
  if (status === ORDER_STATUS_CANCELLED) {
    return 'IDEMPOTENT_CANCELLED';
  }
  if (
    status === ORDER_STATUS_CREATED &&
    fulfillmentStatus === ORDER_FULFILLMENT_PENDING_ACCEPTANCE
  ) {
    return 'APPLY';
  }
  if (fulfillmentStatus !== ORDER_FULFILLMENT_PENDING_ACCEPTANCE) {
    return 'DENIED_FULFILLMENT_STARTED';
  }
  if (
    status === 'COMPLETED' ||
    status === 'FAILED' ||
    status === 'CONFIRMED' ||
    status === 'ACTIVE'
  ) {
    return 'DENIED_TERMINAL';
  }
  return 'DENIED_STATE';
}

export function assertCustomerCancellationAllowed(
  decision: CustomerCancellationDecision,
): void {
  if (decision === 'APPLY' || decision === 'IDEMPOTENT_CANCELLED') {
    return;
  }
  if (decision === 'DENIED_FULFILLMENT_STARTED') {
    throw orderCancellationNotAllowed(
      'Customer cancellation is not allowed after Merchant acceptance or fulfillment has begun',
    );
  }
  throw orderCancellationNotAllowed(
    'Customer cancellation is not allowed for this Order state',
  );
}

/**
 * Optional free-text reason. Empty/omitted → default reason.
 * Rejects HTML/control characters. Never interpreted as code.
 */
export function normalizeCustomerCancellationReason(
  raw: string | undefined | null,
): string {
  if (raw === undefined || raw === null) {
    return 'Customer cancelled before Merchant acceptance';
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'Customer cancelled before Merchant acceptance';
  }
  if (trimmed.length > CUSTOMER_CANCELLATION_REASON_MAX_LENGTH) {
    throw orderCancellationReasonInvalid();
  }
  if (containsForbiddenReasonChars(trimmed)) {
    throw orderCancellationReasonInvalid(
      'Cancellation reason must not contain HTML or control characters',
    );
  }
  return trimmed;
}

/** Electronic Payment still open for possible late provider success. */
export function electronicPaymentOpenForLateSuccess(
  method: string,
  status: string,
): boolean {
  return (
    method === 'ELECTRONIC' &&
    (status === PAYMENT_STATUS_PENDING || status === PAYMENT_STATUS_PROCESSING)
  );
}

export function electronicPaymentRequiresRefundIntent(status: string): boolean {
  return status === PAYMENT_STATUS_SUCCEEDED;
}

export function shouldCancelPendingElectronicPayment(status: string): boolean {
  return status === PAYMENT_STATUS_PENDING;
}
