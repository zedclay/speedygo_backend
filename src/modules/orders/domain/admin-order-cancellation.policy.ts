import {
  CUSTOMER_CANCELLATION_REASON_MAX_LENGTH,
  inspectCustomerCancellation,
  type CustomerCancellationDecision,
} from './customer-order-cancellation.policy';
import {
  orderCancellationNotAllowed,
  orderCancellationReasonInvalid,
} from './order.errors';

export const ORDER_STATUS_EVENT_ADMIN_CANCELLED = 'ADMIN_CANCELLED';
export const ORDER_STATUS_EVENT_ACTOR_ADMIN = 'ADMIN';

export const PAID_TERMINAL_REASON_ADMIN_CANCEL =
  'Admin cancelled before Merchant acceptance; refund workflow required';

export type AdminCancellationDecision = CustomerCancellationDecision;

/**
 * Admin early-window cancel uses the same Order state gate as Customer cancel.
 * Actor and event type differ; Delivery / COD blockers still apply at the service layer.
 */
export function inspectAdminCancellation(
  status: string,
  fulfillmentStatus: string,
): AdminCancellationDecision {
  return inspectCustomerCancellation(status, fulfillmentStatus);
}

export function assertAdminCancellationAllowed(
  decision: AdminCancellationDecision,
): void {
  if (decision === 'APPLY' || decision === 'IDEMPOTENT_CANCELLED') {
    return;
  }
  if (decision === 'DENIED_FULFILLMENT_STARTED') {
    throw orderCancellationNotAllowed(
      'Admin cancellation is not allowed after Merchant acceptance or fulfillment has begun',
    );
  }
  throw orderCancellationNotAllowed(
    'Admin cancellation is not allowed for this Order state',
  );
}

/**
 * Required free-text reason for Admin cancel (Audit + OrderCancellation).
 * Rejects HTML/control characters. Never interpreted as code.
 */
export function normalizeAdminCancellationReason(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw orderCancellationReasonInvalid('Admin cancellation reason is required');
  }
  if (trimmed.length > CUSTOMER_CANCELLATION_REASON_MAX_LENGTH) {
    throw orderCancellationReasonInvalid();
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127 || trimmed[i] === '<' || trimmed[i] === '>') {
      throw orderCancellationReasonInvalid(
        'Cancellation reason must not contain HTML or control characters',
      );
    }
  }
  return trimmed;
}
