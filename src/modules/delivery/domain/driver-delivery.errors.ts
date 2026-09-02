import { AppError } from '../../../common/errors/app.error';

export const DRIVER_DELIVERY_ERROR_CODES = {
  DRIVER_DELIVERY_NOT_FOUND: 'DRIVER_DELIVERY_NOT_FOUND',
  DRIVER_DELIVERY_INVALID_STATE: 'DRIVER_DELIVERY_INVALID_STATE',
  DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE:
    'DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE',
  DRIVER_DELIVERY_ACTION_NOT_ALLOWED: 'DRIVER_DELIVERY_ACTION_NOT_ALLOWED',
  DRIVER_DELIVERY_PAYMENT_NOT_READY: 'DRIVER_DELIVERY_PAYMENT_NOT_READY',
  DRIVER_DELIVERY_COD_COMPLETION_NOT_READY:
    'DRIVER_DELIVERY_COD_COMPLETION_NOT_READY',
  DRIVER_DELIVERY_LOCATION_REQUIRED: 'DRIVER_DELIVERY_LOCATION_REQUIRED',
  DRIVER_DELIVERY_LOCATION_STALE: 'DRIVER_DELIVERY_LOCATION_STALE',
  DRIVER_DELIVERY_NOT_NEAR_PICKUP: 'DRIVER_DELIVERY_NOT_NEAR_PICKUP',
  DRIVER_DELIVERY_NOT_NEAR_DROPOFF: 'DRIVER_DELIVERY_NOT_NEAR_DROPOFF',
} as const;

export type DriverDeliveryErrorCode =
  (typeof DRIVER_DELIVERY_ERROR_CODES)[keyof typeof DRIVER_DELIVERY_ERROR_CODES];

export class DriverDeliveryError extends AppError {
  constructor(
    code: DriverDeliveryErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'DriverDeliveryError';
  }

  declare readonly code: DriverDeliveryErrorCode;
}

export function driverDeliveryNotFound(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_NOT_FOUND,
    'Delivery was not found',
    404,
  );
}

export function driverDeliveryInvalidState(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_INVALID_STATE,
    'Delivery is not in the required state for this action',
    409,
  );
}

export function driverDeliveryAssignmentNotActive(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE,
    'No active Driver assignment',
    409,
  );
}

export function driverDeliveryActionNotAllowed(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_ACTION_NOT_ALLOWED,
    'Driver cannot perform this Delivery action',
    409,
  );
}

export function driverDeliveryPaymentNotReady(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_PAYMENT_NOT_READY,
    'Payment is not eligible for Delivery completion',
    409,
  );
}

export function driverDeliveryCodCompletionNotReady(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_COD_COMPLETION_NOT_READY,
    'COD Delivery cannot be completed until COD Foundation records collection',
    409,
  );
}

export function driverDeliveryLocationRequired(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_LOCATION_REQUIRED,
    'A current Driver location is required for this arrival action',
    409,
  );
}

export function driverDeliveryLocationStale(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_LOCATION_STALE,
    'Driver location is older than the allowed freshness window',
    409,
  );
}

export function driverDeliveryNotNearPickup(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_NOT_NEAR_PICKUP,
    'Driver is not within the pickup proximity radius',
    409,
  );
}

export function driverDeliveryNotNearDropoff(): DriverDeliveryError {
  return new DriverDeliveryError(
    DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_NOT_NEAR_DROPOFF,
    'Driver is not within the dropoff proximity radius',
    409,
  );
}
