import { AppError } from '../../../common/errors/app.error';

export const DELIVERY_ERROR_CODES = {
  DELIVERY_NOT_FOUND: 'DELIVERY_NOT_FOUND',
  DELIVERY_ORDER_NOT_ELIGIBLE: 'DELIVERY_ORDER_NOT_ELIGIBLE',
  DELIVERY_PAYMENT_NOT_READY: 'DELIVERY_PAYMENT_NOT_READY',
} as const;

export type DeliveryErrorCode =
  (typeof DELIVERY_ERROR_CODES)[keyof typeof DELIVERY_ERROR_CODES];

export class DeliveryError extends AppError {
  constructor(
    code: DeliveryErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'DeliveryError';
  }

  declare readonly code: DeliveryErrorCode;
}

export function deliveryNotFound(): DeliveryError {
  return new DeliveryError(
    DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND,
    'Delivery was not found',
    404,
  );
}

export function deliveryOrderNotEligible(): DeliveryError {
  return new DeliveryError(
    DELIVERY_ERROR_CODES.DELIVERY_ORDER_NOT_ELIGIBLE,
    'Order is not eligible for Delivery creation',
    409,
  );
}

export function deliveryPaymentNotReady(): DeliveryError {
  return new DeliveryError(
    DELIVERY_ERROR_CODES.DELIVERY_PAYMENT_NOT_READY,
    'Payment is not eligible for Delivery creation',
    409,
  );
}
