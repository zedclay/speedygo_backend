import {
  amountsMatch,
  initiationIdempotencyKey,
  isElectronicMethod,
  isFrozenCurrency,
  isOpenAttemptStatus,
  isPaymentCancelled,
  isPaymentExecutionTerminal,
  isPaymentInitiableOrderStatus,
  normalizeProviderCurrency,
  PAYMENT_TX_CREATED,
  PAYMENT_TX_INITIATED,
  uniquePaymentIds,
  webhookIdempotencyKey,
} from './payment.policy';

describe('payment.policy', () => {
  it('treats only ELECTRONIC as electronic', () => {
    expect(isElectronicMethod('ELECTRONIC')).toBe(true);
    expect(isElectronicMethod('COD')).toBe(false);
  });

  it('allows initiation only for CREATED, CONFIRMED, and ACTIVE Orders', () => {
    expect(isPaymentInitiableOrderStatus('CREATED')).toBe(true);
    expect(isPaymentInitiableOrderStatus('CONFIRMED')).toBe(true);
    expect(isPaymentInitiableOrderStatus('ACTIVE')).toBe(true);
    expect(isPaymentInitiableOrderStatus('CANCELLED')).toBe(false);
    expect(isPaymentInitiableOrderStatus('COMPLETED')).toBe(false);
    expect(isPaymentInitiableOrderStatus('FAILED')).toBe(false);
  });

  it('treats SUCCEEDED as execution-terminal', () => {
    expect(isPaymentExecutionTerminal('SUCCEEDED')).toBe(true);
    expect(isPaymentExecutionTerminal('PENDING')).toBe(false);
    expect(isPaymentCancelled('CANCELLED')).toBe(true);
  });

  it('freezes DZD and requires exact integer amount equality', () => {
    expect(isFrozenCurrency('DZD')).toBe(true);
    expect(isFrozenCurrency('USD')).toBe(false);
    expect(amountsMatch(1700, 1700)).toBe(true);
    expect(amountsMatch(1700, 1701)).toBe(false);
    expect(amountsMatch(1.5, 1.5)).toBe(false);
  });

  it('normalizes provider currency to DZD', () => {
    expect(normalizeProviderCurrency('dzd')).toBe('DZD');
    expect(normalizeProviderCurrency(undefined)).toBe('DZD');
  });

  it('reuses CREATED/INITIATED as open attempts', () => {
    expect(isOpenAttemptStatus(PAYMENT_TX_CREATED)).toBe(true);
    expect(isOpenAttemptStatus(PAYMENT_TX_INITIATED)).toBe(true);
    expect(isOpenAttemptStatus('FAILED')).toBe(false);
  });

  it('builds stable idempotency keys', () => {
    expect(initiationIdempotencyKey('pay', 'att')).toBe('init:pay:att');
    expect(webhookIdempotencyKey('chargily', 'evt-1')).toBe(
      'wh:chargily:evt-1',
    );
  });

  it('detects ambiguous provider-reference payment ownership', () => {
    expect(
      uniquePaymentIds([
        { paymentId: 'a' },
        { paymentId: 'a' },
        { paymentId: 'b' },
      ]),
    ).toEqual(['a', 'b']);
  });
});
