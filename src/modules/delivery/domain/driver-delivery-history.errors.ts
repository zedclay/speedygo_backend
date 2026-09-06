import { AppError } from '../../../common/errors/app.error';

export const DRIVER_DELIVERY_HISTORY_ERROR_CODES = {
  DRIVER_DELIVERY_HISTORY_NOT_FOUND: 'DRIVER_DELIVERY_HISTORY_NOT_FOUND',
  DRIVER_DELIVERY_HISTORY_QUERY_INVALID:
    'DRIVER_DELIVERY_HISTORY_QUERY_INVALID',
  DRIVER_DELIVERY_HISTORY_INTEGRITY: 'DRIVER_DELIVERY_HISTORY_INTEGRITY',
} as const;

export type DriverDeliveryHistoryErrorCode =
  (typeof DRIVER_DELIVERY_HISTORY_ERROR_CODES)[keyof typeof DRIVER_DELIVERY_HISTORY_ERROR_CODES];

export class DriverDeliveryHistoryError extends AppError {
  constructor(
    code: DriverDeliveryHistoryErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'DriverDeliveryHistoryError';
  }

  declare readonly code: DriverDeliveryHistoryErrorCode;
}

export function driverDeliveryHistoryNotFound(): DriverDeliveryHistoryError {
  return new DriverDeliveryHistoryError(
    DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_NOT_FOUND,
    'Delivery history item was not found',
    404,
  );
}

export function driverDeliveryHistoryQueryInvalid(
  message: string,
): DriverDeliveryHistoryError {
  return new DriverDeliveryHistoryError(
    DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_QUERY_INVALID,
    message,
    400,
  );
}

export function driverDeliveryHistoryIntegrity(
  message = 'Delivery history integrity check failed',
): DriverDeliveryHistoryError {
  return new DriverDeliveryHistoryError(
    DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
    message,
    409,
  );
}
