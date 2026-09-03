import { AppError } from '../../../common/errors/app.error';

export const MERCHANT_COMMISSION_ERROR_CODES = {
  MERCHANT_COMMISSION_RULE_NOT_FOUND: 'MERCHANT_COMMISSION_RULE_NOT_FOUND',
  MERCHANT_COMMISSION_RULE_AMBIGUOUS: 'MERCHANT_COMMISSION_RULE_AMBIGUOUS',
  MERCHANT_COMMISSION_RATE_INVALID: 'MERCHANT_COMMISSION_RATE_INVALID',
  MERCHANT_COMMISSION_BASE_INVALID: 'MERCHANT_COMMISSION_BASE_INVALID',
  MERCHANT_COMMISSION_CONFIGURATION_INVALID:
    'MERCHANT_COMMISSION_CONFIGURATION_INVALID',
} as const;

export type MerchantCommissionErrorCode =
  (typeof MERCHANT_COMMISSION_ERROR_CODES)[keyof typeof MERCHANT_COMMISSION_ERROR_CODES];

export class MerchantCommissionError extends AppError {
  constructor(
    readonly code: MerchantCommissionErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'MerchantCommissionError';
  }
}

export function merchantCommissionRuleNotFound(): MerchantCommissionError {
  return new MerchantCommissionError(
    MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RULE_NOT_FOUND,
    'No applicable merchant commission rule',
    409,
  );
}

export function merchantCommissionRuleAmbiguous(
  message = 'Multiple applicable merchant commission rules',
): MerchantCommissionError {
  return new MerchantCommissionError(
    MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RULE_AMBIGUOUS,
    message,
    409,
  );
}

export function merchantCommissionRateInvalid(): MerchantCommissionError {
  return new MerchantCommissionError(
    MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RATE_INVALID,
    'Merchant commission rateBps must be an integer between 0 and 10000',
    400,
  );
}

export function merchantCommissionBaseInvalid(): MerchantCommissionError {
  return new MerchantCommissionError(
    MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_BASE_INVALID,
    'Merchant commission base must be a non-negative integer minor amount',
    400,
  );
}

export function merchantCommissionConfigurationInvalid(
  message = 'Merchant commission configuration is invalid',
): MerchantCommissionError {
  return new MerchantCommissionError(
    MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_CONFIGURATION_INVALID,
    message,
    409,
  );
}
