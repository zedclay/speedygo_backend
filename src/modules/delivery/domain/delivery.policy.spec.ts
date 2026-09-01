import {
  DELIVERY_INITIAL_STATUS,
  DELIVERY_STATUS_SEARCHING_DRIVER,
  isDeliveryPaymentEligible,
  isOrderEligibleForDelivery,
  isTerminalDeliveryStatus,
} from './delivery.policy';

describe('Delivery policy', () => {
  it('allows Delivery only for ACTIVE + READY', () => {
    expect(isOrderEligibleForDelivery('ACTIVE', 'READY')).toBe(true);
    expect(isOrderEligibleForDelivery('CREATED', 'PENDING_ACCEPTANCE')).toBe(
      false,
    );
    expect(isOrderEligibleForDelivery('CONFIRMED', 'ACCEPTED')).toBe(false);
    expect(isOrderEligibleForDelivery('ACTIVE', 'PREPARING')).toBe(false);
    expect(isOrderEligibleForDelivery('CANCELLED', 'PENDING_ACCEPTANCE')).toBe(
      false,
    );
    expect(isOrderEligibleForDelivery('FAILED', 'READY')).toBe(false);
    expect(isOrderEligibleForDelivery('COMPLETED', 'READY')).toBe(false);
  });

  it('allows COD PENDING and requires ELECTRONIC SUCCEEDED', () => {
    expect(isDeliveryPaymentEligible('COD', 'PENDING')).toBe(true);
    expect(isDeliveryPaymentEligible('ELECTRONIC', 'SUCCEEDED')).toBe(true);
    expect(isDeliveryPaymentEligible('ELECTRONIC', 'PENDING')).toBe(false);
    expect(isDeliveryPaymentEligible('ELECTRONIC', 'FAILED')).toBe(false);
    expect(isDeliveryPaymentEligible('ELECTRONIC', 'CANCELLED')).toBe(false);
    expect(isDeliveryPaymentEligible('COD', 'FAILED')).toBe(false);
    expect(isDeliveryPaymentEligible('COD', 'CANCELLED')).toBe(false);
  });

  it('starts Delivery at SEARCHING_DRIVER and treats FAILED/CANCELLED/DELIVERED as terminal', () => {
    expect(DELIVERY_INITIAL_STATUS).toBe(DELIVERY_STATUS_SEARCHING_DRIVER);
    expect(isTerminalDeliveryStatus('DELIVERED')).toBe(true);
    expect(isTerminalDeliveryStatus('FAILED')).toBe(true);
    expect(isTerminalDeliveryStatus('CANCELLED')).toBe(true);
    expect(isTerminalDeliveryStatus('SEARCHING_DRIVER')).toBe(false);
  });
});
