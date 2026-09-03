import {
  ORDER_CURRENCY_DZD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_CONFIRMED,
  ORDER_STATUS_CREATED,
  PAYMENT_STATUS_CANCELLED,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';

export const PAYMENT_CURRENCY_DZD = ORDER_CURRENCY_DZD;
export const PAYMENT_PROVIDER_TEST = 'test';
export const PAYMENT_PROVIDER_CHARGILY = 'chargily';

export const PAYMENT_TX_CREATED = 'CREATED';
export const PAYMENT_TX_INITIATED = 'INITIATED';
export const PAYMENT_TX_SUCCEEDED = 'SUCCEEDED';
export const PAYMENT_TX_FAILED = 'FAILED';
export const PAYMENT_TX_CANCELLED = 'CANCELLED';
export const PAYMENT_TX_IGNORED = 'IGNORED';

export const OPEN_PAYMENT_ATTEMPT_STATUSES = [
  PAYMENT_TX_CREATED,
  PAYMENT_TX_INITIATED,
] as const;

export function isElectronicMethod(method: string): boolean {
  return method === ORDER_PAYMENT_METHOD_ELECTRONIC;
}

export function isPaymentInitiableOrderStatus(status: string): boolean {
  return (
    status === ORDER_STATUS_CREATED ||
    status === ORDER_STATUS_CONFIRMED ||
    status === ORDER_STATUS_ACTIVE
  );
}

export function isPaymentExecutionTerminal(status: string): boolean {
  return status === PAYMENT_STATUS_SUCCEEDED;
}

export function isPaymentCancelled(status: string): boolean {
  return status === PAYMENT_STATUS_CANCELLED;
}

export function isFrozenCurrency(currency: string): boolean {
  return currency === PAYMENT_CURRENCY_DZD;
}

export function amountsMatch(
  paymentAmountMinor: number,
  snapshotPayableMinor: number,
): boolean {
  return (
    Number.isInteger(paymentAmountMinor) &&
    Number.isInteger(snapshotPayableMinor) &&
    paymentAmountMinor === snapshotPayableMinor &&
    paymentAmountMinor >= 0
  );
}

export function isOpenAttemptStatus(status: string): boolean {
  return (OPEN_PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

export function initiationIdempotencyKey(
  paymentId: string,
  attemptId: string,
): string {
  return `init:${paymentId}:${attemptId}`;
}

export function webhookIdempotencyKey(
  provider: string,
  eventId: string,
): string {
  return `wh:${provider}:${eventId}`;
}

export function normalizeProviderCurrency(value: string | undefined): string {
  if (!value) {
    return PAYMENT_CURRENCY_DZD;
  }
  return value.trim().toUpperCase();
}

export function uniquePaymentIds(rows: Array<{ paymentId: string }>): string[] {
  return [...new Set(rows.map((row) => row.paymentId))];
}
