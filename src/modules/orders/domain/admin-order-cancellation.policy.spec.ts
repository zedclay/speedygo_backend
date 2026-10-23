import {
  assertAdminCancellationAllowed,
  inspectAdminCancellation,
  normalizeAdminCancellationReason,
} from './admin-order-cancellation.policy';
import { ORDER_ERROR_CODES } from './order.errors';

describe('admin-order-cancellation.policy', () => {
  it('allows CREATED + PENDING_ACCEPTANCE', () => {
    expect(inspectAdminCancellation('CREATED', 'PENDING_ACCEPTANCE')).toBe(
      'APPLY',
    );
  });

  it('is idempotent when already CANCELLED', () => {
    expect(inspectAdminCancellation('CANCELLED', 'PENDING_ACCEPTANCE')).toBe(
      'IDEMPOTENT_CANCELLED',
    );
  });

  it('denies after fulfillment started', () => {
    expect(inspectAdminCancellation('CONFIRMED', 'ACCEPTED')).toBe(
      'DENIED_FULFILLMENT_STARTED',
    );
    expect(() =>
      assertAdminCancellationAllowed('DENIED_FULFILLMENT_STARTED'),
    ).toThrow(
      expect.objectContaining({
        code: ORDER_ERROR_CODES.ORDER_CANCELLATION_NOT_ALLOWED,
      }),
    );
  });

  it('requires a non-empty sanitized reason', () => {
    expect(() => normalizeAdminCancellationReason('  ')).toThrow(
      expect.objectContaining({
        code: ORDER_ERROR_CODES.ORDER_CANCELLATION_REASON_INVALID,
      }),
    );
    expect(() => normalizeAdminCancellationReason('<script>')).toThrow(
      expect.objectContaining({
        code: ORDER_ERROR_CODES.ORDER_CANCELLATION_REASON_INVALID,
      }),
    );
    expect(normalizeAdminCancellationReason(' Ops decision ')).toBe(
      'Ops decision',
    );
  });
});
