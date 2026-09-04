import { AppError } from '../../../common/errors/app.error';

export const REFUND_ERROR_CODES = {
  REFUND_NOT_FOUND: 'REFUND_NOT_FOUND',
  REFUND_PAYMENT_NOT_SUCCEEDED: 'REFUND_PAYMENT_NOT_SUCCEEDED',
  REFUND_AMOUNT_INVALID: 'REFUND_AMOUNT_INVALID',
  REFUND_INSUFFICIENT_REMAINING: 'REFUND_INSUFFICIENT_REMAINING',
  REFUND_ORDER_NOT_ELIGIBLE: 'REFUND_ORDER_NOT_ELIGIBLE',
  REFUND_FINANCIAL_STATE_INVALID: 'REFUND_FINANCIAL_STATE_INVALID',
  REFUND_METHOD_INVALID: 'REFUND_METHOD_INVALID',
  REFUND_INVALID_STATE: 'REFUND_INVALID_STATE',
  REFUND_CURRENCY_MISMATCH: 'REFUND_CURRENCY_MISMATCH',
  REFUND_PROVIDER_UNSUPPORTED: 'REFUND_PROVIDER_UNSUPPORTED',
  REFUND_ADMIN_REQUIRED: 'REFUND_ADMIN_REQUIRED',
  REFUND_REASON_INVALID: 'REFUND_REASON_INVALID',
  REFUND_PAYMENT_TRANSACTION_INVALID: 'REFUND_PAYMENT_TRANSACTION_INVALID',
} as const;

export type RefundErrorCode =
  (typeof REFUND_ERROR_CODES)[keyof typeof REFUND_ERROR_CODES];

export class RefundError extends AppError {
  constructor(
    readonly code: RefundErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'RefundError';
  }
}

export function refundNotFound(): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_NOT_FOUND,
    'Refund not found',
    404,
  );
}

export function refundPaymentNotSucceeded(): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_PAYMENT_NOT_SUCCEEDED,
    'Refund requires a SUCCEEDED Payment',
    409,
  );
}

export function refundAmountInvalid(
  message = 'Refund amount must be a positive integer minor amount',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_AMOUNT_INVALID,
    message,
    400,
  );
}

export function refundInsufficientRemaining(): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
    'Requested refund exceeds remaining refundable amount',
    409,
  );
}

export function refundOrderNotEligible(
  message = 'Order status is not eligible for Refund creation',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_ORDER_NOT_ELIGIBLE,
    message,
    409,
  );
}

export function refundFinancialStateInvalid(
  message = 'Refund financial state is invalid',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_FINANCIAL_STATE_INVALID,
    message,
    409,
  );
}

export function refundMethodInvalid(
  message = 'Refund method is invalid for this Payment',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_METHOD_INVALID,
    message,
    400,
  );
}

export function refundInvalidState(
  message = 'Refund status transition is not allowed',
): RefundError {
  return new RefundError(REFUND_ERROR_CODES.REFUND_INVALID_STATE, message, 409);
}

export function refundCurrencyMismatch(): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_CURRENCY_MISMATCH,
    'Refund currency must match Payment currency (DZD)',
    409,
  );
}

export function refundProviderUnsupported(
  message = 'Provider refund execution is not supported',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_PROVIDER_UNSUPPORTED,
    message,
    503,
  );
}

export function refundAdminRequired(
  message = 'Trusted AdminProfile is required for this Refund action',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_ADMIN_REQUIRED,
    message,
    409,
  );
}

export function refundReasonInvalid(
  message = 'Refund reason is required and must be at most 255 characters',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_REASON_INVALID,
    message,
    400,
  );
}

export function refundPaymentTransactionInvalid(
  message = 'Refund requires a valid SUCCEEDED PaymentTransaction',
): RefundError {
  return new RefundError(
    REFUND_ERROR_CODES.REFUND_PAYMENT_TRANSACTION_INVALID,
    message,
    409,
  );
}
