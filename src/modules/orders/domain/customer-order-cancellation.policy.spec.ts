import {
  assertCustomerCancellationAllowed,
  inspectCustomerCancellation,
  normalizeCustomerCancellationReason,
} from './customer-order-cancellation.policy';
import { ORDER_ERROR_CODES } from './order.errors';

describe('customer order cancellation policy', () => {
  it('allows CREATED + PENDING_ACCEPTANCE', () => {
    expect(inspectCustomerCancellation('CREATED', 'PENDING_ACCEPTANCE')).toBe(
      'APPLY',
    );
  });

  it('is idempotent for CANCELLED', () => {
    expect(inspectCustomerCancellation('CANCELLED', 'PENDING_ACCEPTANCE')).toBe(
      'IDEMPOTENT_CANCELLED',
    );
  });

  it.each([
    ['CONFIRMED', 'ACCEPTED'],
    ['ACTIVE', 'PREPARING'],
    ['ACTIVE', 'READY'],
    ['COMPLETED', 'READY'],
    ['FAILED', 'PENDING_ACCEPTANCE'],
  ] as const)('denies %s/%s', (status, fulfillment) => {
    const decision = inspectCustomerCancellation(status, fulfillment);
    expect(decision).not.toBe('APPLY');
    try {
      assertCustomerCancellationAllowed(decision);
      throw new Error('expected denial');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_CANCELLATION_NOT_ALLOWED,
      );
    }
  });

  it('normalizes empty reason', () => {
    expect(normalizeCustomerCancellationReason(undefined)).toContain(
      'Customer cancelled',
    );
    expect(normalizeCustomerCancellationReason('  ')).toContain(
      'Customer cancelled',
    );
  });

  it('rejects HTML and control characters', () => {
    try {
      normalizeCustomerCancellationReason('<script>x</script>');
      throw new Error('expected invalid');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_CANCELLATION_REASON_INVALID,
      );
    }
    try {
      normalizeCustomerCancellationReason('bad\nline');
      throw new Error('expected invalid');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ORDER_ERROR_CODES.ORDER_CANCELLATION_REASON_INVALID,
      );
    }
  });

  it('accepts trimmed plain reason', () => {
    expect(normalizeCustomerCancellationReason('  Changed mind  ')).toBe(
      'Changed mind',
    );
  });
});
