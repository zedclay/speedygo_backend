import { AppError } from '../../../common/errors/app.error';

export const MERCHANT_SETTLEMENT_ERROR_CODES = {
  MERCHANT_SETTLEMENT_NOT_FOUND: 'MERCHANT_SETTLEMENT_NOT_FOUND',
  MERCHANT_SETTLEMENT_INVALID_STATE: 'MERCHANT_SETTLEMENT_INVALID_STATE',
  MERCHANT_SETTLEMENT_PERIOD_INVALID: 'MERCHANT_SETTLEMENT_PERIOD_INVALID',
  MERCHANT_SETTLEMENT_ORDER_NOT_ELIGIBLE:
    'MERCHANT_SETTLEMENT_ORDER_NOT_ELIGIBLE',
  MERCHANT_SETTLEMENT_SALE_EXISTS: 'MERCHANT_SETTLEMENT_SALE_EXISTS',
  MERCHANT_SETTLEMENT_REFUND_NOT_ELIGIBLE:
    'MERCHANT_SETTLEMENT_REFUND_NOT_ELIGIBLE',
  MERCHANT_SETTLEMENT_REFUND_ADJUSTMENT_EXISTS:
    'MERCHANT_SETTLEMENT_REFUND_ADJUSTMENT_EXISTS',
  MERCHANT_SETTLEMENT_LIABILITY_INVALID:
    'MERCHANT_SETTLEMENT_LIABILITY_INVALID',
  MERCHANT_SETTLEMENT_SALE_REQUIRED: 'MERCHANT_SETTLEMENT_SALE_REQUIRED',
  MERCHANT_SETTLEMENT_MERCHANT_MISMATCH:
    'MERCHANT_SETTLEMENT_MERCHANT_MISMATCH',
  MERCHANT_SETTLEMENT_ADMIN_REQUIRED: 'MERCHANT_SETTLEMENT_ADMIN_REQUIRED',
  MERCHANT_SETTLEMENT_FINANCIAL_STATE_INVALID:
    'MERCHANT_SETTLEMENT_FINANCIAL_STATE_INVALID',
  MERCHANT_SETTLEMENT_DRAFT_EXISTS: 'MERCHANT_SETTLEMENT_DRAFT_EXISTS',
} as const;

export type MerchantSettlementErrorCode =
  (typeof MERCHANT_SETTLEMENT_ERROR_CODES)[keyof typeof MERCHANT_SETTLEMENT_ERROR_CODES];

export class MerchantSettlementError extends AppError {
  constructor(
    readonly code: MerchantSettlementErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'MerchantSettlementError';
  }
}

export function merchantSettlementNotFound(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_NOT_FOUND,
    'Merchant settlement not found',
    404,
  );
}

export function merchantSettlementInvalidState(
  message = 'Merchant settlement status transition is not allowed',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_INVALID_STATE,
    message,
    409,
  );
}

export function merchantSettlementPeriodInvalid(
  message = 'Settlement period is invalid',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_PERIOD_INVALID,
    message,
    400,
  );
}

export function merchantSettlementOrderNotEligible(
  message = 'Order is not eligible for a SALE settlement line',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_ORDER_NOT_ELIGIBLE,
    message,
    409,
  );
}

export function merchantSettlementSaleExists(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_SALE_EXISTS,
    'Order already has a SALE settlement line',
    409,
  );
}

export function merchantSettlementRefundNotEligible(
  message = 'Refund is not eligible for Merchant REFUND_ADJUSTMENT',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_REFUND_NOT_ELIGIBLE,
    message,
    409,
  );
}

export function merchantSettlementRefundAdjustmentExists(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_REFUND_ADJUSTMENT_EXISTS,
    'Refund already has a Merchant REFUND_ADJUSTMENT line',
    409,
  );
}

export function merchantSettlementLiabilityInvalid(
  message = 'Merchant refund liability amount is invalid',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_LIABILITY_INVALID,
    message,
    400,
  );
}

export function merchantSettlementSaleRequired(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_SALE_REQUIRED,
    'REFUND_ADJUSTMENT requires an existing SALE settlement line for the Order',
    409,
  );
}

export function merchantSettlementMerchantMismatch(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_MERCHANT_MISMATCH,
    'Settlement Merchant does not match Order Merchant',
    409,
  );
}

export function merchantSettlementAdminRequired(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_ADMIN_REQUIRED,
    'Trusted AdminProfile is required for this settlement action',
    409,
  );
}

export function merchantSettlementFinancialStateInvalid(
  message = 'Settlement financial state is invalid',
): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_FINANCIAL_STATE_INVALID,
    message,
    409,
  );
}

export function merchantSettlementDraftExists(): MerchantSettlementError {
  return new MerchantSettlementError(
    MERCHANT_SETTLEMENT_ERROR_CODES.MERCHANT_SETTLEMENT_DRAFT_EXISTS,
    'Merchant already has an open DRAFT settlement',
    409,
  );
}
