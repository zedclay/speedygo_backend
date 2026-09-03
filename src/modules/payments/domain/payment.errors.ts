import { AppError } from '../../../common/errors/app.error';

export const PAYMENT_ERROR_CODES = {
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_METHOD_NOT_ELECTRONIC: 'PAYMENT_METHOD_NOT_ELECTRONIC',
  PAYMENT_ALREADY_SUCCEEDED: 'PAYMENT_ALREADY_SUCCEEDED',
  PAYMENT_NOT_INITIABLE: 'PAYMENT_NOT_INITIABLE',
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
  PAYMENT_PROVIDER_CONFIGURATION_INVALID:
    'PAYMENT_PROVIDER_CONFIGURATION_INVALID',
  PAYMENT_AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
  PAYMENT_CURRENCY_MISMATCH: 'PAYMENT_CURRENCY_MISMATCH',
  PAYMENT_WEBHOOK_INVALID_SIGNATURE: 'PAYMENT_WEBHOOK_INVALID_SIGNATURE',
  PAYMENT_WEBHOOK_UNKNOWN_REFERENCE: 'PAYMENT_WEBHOOK_UNKNOWN_REFERENCE',
  PAYMENT_INVALID_STATE: 'PAYMENT_INVALID_STATE',
} as const;

export type PaymentErrorCode =
  (typeof PAYMENT_ERROR_CODES)[keyof typeof PAYMENT_ERROR_CODES];

export class PaymentError extends AppError {
  constructor(code: PaymentErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'PaymentError';
  }

  declare readonly code: PaymentErrorCode;
}

export function paymentNotFound(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_NOT_FOUND,
    'Payment was not found',
    404,
  );
}

export function paymentMethodNotElectronic(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_METHOD_NOT_ELECTRONIC,
    'Electronic initiation is only allowed for ELECTRONIC Payments',
    409,
  );
}

export function paymentAlreadySucceeded(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_ALREADY_SUCCEEDED,
    'Payment has already succeeded',
    409,
  );
}

export function paymentNotInitiable(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_NOT_INITIABLE,
    'Payment cannot be initiated in the current Order or Payment state',
    409,
  );
}

export function paymentProviderUnavailable(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE,
    'Payment provider is unavailable',
    503,
  );
}

export function paymentProviderConfigurationInvalid(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID,
    'Payment provider is not configured',
    503,
  );
}

export function paymentAmountMismatch(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
    'Payment amount does not match the frozen Order financial snapshot',
    409,
  );
}

export function paymentCurrencyMismatch(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_CURRENCY_MISMATCH,
    'Payment currency is not the frozen SpeedyGo currency',
    409,
  );
}

export function paymentWebhookInvalidSignature(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_INVALID_SIGNATURE,
    'Payment webhook signature is invalid',
    401,
  );
}

export function paymentWebhookUnknownReference(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_UNKNOWN_REFERENCE,
    'Payment webhook reference is unknown',
    404,
  );
}

export function paymentInvalidState(): PaymentError {
  return new PaymentError(
    PAYMENT_ERROR_CODES.PAYMENT_INVALID_STATE,
    'Payment is not in the required state',
    409,
  );
}
