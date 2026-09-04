import {
  ORDER_PAYMENT_METHOD_COD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CREATED,
} from '../../orders/domain/order.policy';
import { REFUND_ERROR_CODES } from './refund.errors';
import {
  ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE,
  calculateRefundCapacity,
  canConfirmManualRefund,
  isRefundEligibleOrderStatus,
  isReleasedRefundStatus,
  isReservingRefundStatus,
  requireEligibleOrderStatus,
  requirePaymentSnapshotConsistency,
  requirePositiveRefundAmount,
  requireRefundableAmount,
  requireSucceededPayment,
  resolveRefundMethodBinding,
} from './refund.policy';
import {
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
  REFUND_METHOD_ORIGINAL_PAYMENT,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_FAILED,
  REFUND_STATUS_PROCESSING,
  REFUND_STATUS_REFUNDED,
  REFUND_STATUS_REJECTED,
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
} from './refund.types';

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect((error as { code: string }).code).toBe(code);
  }
}

describe('refund.policy (FINAL)', () => {
  it('rejects unpaid Payment', () => {
    expectCode(
      () => requireSucceededPayment('PENDING'),
      REFUND_ERROR_CODES.REFUND_PAYMENT_NOT_SUCCEEDED,
    );
  });

  it('validates positive integer refund amounts only', () => {
    expectCode(
      () => requirePositiveRefundAmount(0),
      REFUND_ERROR_CODES.REFUND_AMOUNT_INVALID,
    );
    expectCode(
      () => requirePositiveRefundAmount(-1),
      REFUND_ERROR_CODES.REFUND_AMOUNT_INVALID,
    );
    expectCode(
      () => requirePositiveRefundAmount(1.5),
      REFUND_ERROR_CODES.REFUND_AMOUNT_INVALID,
    );
    expect(requirePositiveRefundAmount(3000)).toBe(3000);
  });

  it('reserves and releases exact status sets', () => {
    for (const status of [
      REFUND_STATUS_REQUESTED,
      REFUND_STATUS_UNDER_REVIEW,
      REFUND_STATUS_APPROVED,
      REFUND_STATUS_PROCESSING,
      REFUND_STATUS_REFUNDED,
    ]) {
      expect(isReservingRefundStatus(status)).toBe(true);
    }
    expect(isReleasedRefundStatus(REFUND_STATUS_REJECTED)).toBe(true);
    expect(isReleasedRefundStatus(REFUND_STATUS_FAILED)).toBe(true);
    expect(isReservingRefundStatus(REFUND_STATUS_REJECTED)).toBe(false);
  });

  it('computes remaining after reserved refunds', () => {
    const capacity = calculateRefundCapacity({
      originalPaidMinor: 10_000,
      reservedRefundMinor: 5_000,
      successfulRefundMinor: 5_000,
    });
    expect(capacity.remainingRefundableMinor).toBe(5_000);
  });

  it('blocks over-refund against remaining', () => {
    expectCode(
      () => requireRefundableAmount(3_000, 2_000),
      REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
    );
  });

  it('allows only COMPLETED/CANCELLED/FAILED Orders', () => {
    expect(isRefundEligibleOrderStatus(ORDER_STATUS_COMPLETED)).toBe(true);
    expect(isRefundEligibleOrderStatus(ORDER_STATUS_CANCELLED)).toBe(true);
    expect(isRefundEligibleOrderStatus(ORDER_STATUS_ACTIVE)).toBe(false);
    expect(isRefundEligibleOrderStatus(ORDER_STATUS_CREATED)).toBe(false);
    expectCode(
      () => requireEligibleOrderStatus(ORDER_STATUS_ACTIVE),
      REFUND_ERROR_CODES.REFUND_ORDER_NOT_ELIGIBLE,
    );
  });

  it('requires Payment/snapshot consistency in DZD', () => {
    expectCode(
      () =>
        requirePaymentSnapshotConsistency({
          paymentAmountMinor: 10_000,
          snapshotPayableMinor: 9_000,
          paymentCurrency: 'DZD',
          snapshotCurrency: 'DZD',
        }),
      REFUND_ERROR_CODES.REFUND_FINANCIAL_STATE_INVALID,
    );
  });

  it('maps COD→MANUAL_COD and ELECTRONIC→MANUAL_OTHER only', () => {
    expect(
      resolveRefundMethodBinding({
        refundMethod: REFUND_METHOD_MANUAL_COD,
        paymentMethod: ORDER_PAYMENT_METHOD_COD,
        paymentTransactionId: null,
      }).refundMethod,
    ).toBe(REFUND_METHOD_MANUAL_COD);

    expectCode(
      () =>
        resolveRefundMethodBinding({
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          paymentMethod: ORDER_PAYMENT_METHOD_COD,
          paymentTransactionId: null,
        }),
      REFUND_ERROR_CODES.REFUND_METHOD_INVALID,
    );

    expect(
      resolveRefundMethodBinding({
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        paymentMethod: ORDER_PAYMENT_METHOD_ELECTRONIC,
        paymentTransactionId: null,
      }).refundMethod,
    ).toBe(REFUND_METHOD_MANUAL_OTHER);

    expectCode(
      () =>
        resolveRefundMethodBinding({
          refundMethod: REFUND_METHOD_MANUAL_COD,
          paymentMethod: ORDER_PAYMENT_METHOD_ELECTRONIC,
          paymentTransactionId: null,
        }),
      REFUND_ERROR_CODES.REFUND_METHOD_INVALID,
    );
  });

  it('disables ORIGINAL_PAYMENT without inventing execution failure', () => {
    try {
      resolveRefundMethodBinding({
        refundMethod: REFUND_METHOD_ORIGINAL_PAYMENT,
        paymentMethod: ORDER_PAYMENT_METHOD_ELECTRONIC,
        paymentTransactionId: 'tx-1',
      });
      throw new Error('expected unsupported');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        REFUND_ERROR_CODES.REFUND_PROVIDER_UNSUPPORTED,
      );
      expect((error as Error).message).toContain(
        ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE.slice(0, 40),
      );
    }
  });

  it('allows manual confirm only from APPROVED manual methods', () => {
    expect(
      canConfirmManualRefund(
        REFUND_STATUS_APPROVED,
        REFUND_METHOD_MANUAL_OTHER,
      ),
    ).toBe(true);
    expect(
      canConfirmManualRefund(
        REFUND_STATUS_PROCESSING,
        REFUND_METHOD_MANUAL_OTHER,
      ),
    ).toBe(false);
    expect(
      canConfirmManualRefund(
        REFUND_STATUS_APPROVED,
        REFUND_METHOD_ORIGINAL_PAYMENT,
      ),
    ).toBe(false);
    expect(
      canConfirmManualRefund(REFUND_STATUS_REQUESTED, REFUND_METHOD_MANUAL_COD),
    ).toBe(false);
  });

  it('does not invent component recalculation helpers', () => {
    const capacity = calculateRefundCapacity({
      originalPaidMinor: 1700,
      reservedRefundMinor: 500,
      successfulRefundMinor: 0,
    });
    expect(capacity.remainingRefundableMinor).toBe(1200);
    expect(Object.keys(capacity).sort()).toEqual(
      [
        'currency',
        'originalPaidMinor',
        'remainingRefundableMinor',
        'reservedRefundMinor',
        'successfulRefundMinor',
      ].sort(),
    );
  });
});
