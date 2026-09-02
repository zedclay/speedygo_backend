import { AppError } from '../../../common/errors/app.error';

export const TRACKING_ERROR_CODES = {
  TRACKING_UNAUTHORIZED: 'TRACKING_UNAUTHORIZED',
  TRACKING_DELIVERY_NOT_FOUND: 'TRACKING_DELIVERY_NOT_FOUND',
  TRACKING_ASSIGNMENT_NOT_ACTIVE: 'TRACKING_ASSIGNMENT_NOT_ACTIVE',
  DRIVER_LOCATION_INVALID: 'DRIVER_LOCATION_INVALID',
  DRIVER_LOCATION_NOT_ALLOWED: 'DRIVER_LOCATION_NOT_ALLOWED',
  DRIVER_LOCATION_RATE_LIMITED: 'DRIVER_LOCATION_RATE_LIMITED',
  DRIVER_LOCATION_STORE_UNAVAILABLE: 'DRIVER_LOCATION_STORE_UNAVAILABLE',
} as const;

export type TrackingErrorCode =
  (typeof TRACKING_ERROR_CODES)[keyof typeof TRACKING_ERROR_CODES];

export class TrackingError extends AppError {
  constructor(code: TrackingErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'TrackingError';
  }

  declare readonly code: TrackingErrorCode;
}

export function trackingUnauthorized(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.TRACKING_UNAUTHORIZED,
    'Tracking is not available',
    404,
  );
}

export function trackingDeliveryNotFound(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.TRACKING_DELIVERY_NOT_FOUND,
    'Tracking is not available',
    404,
  );
}

export function trackingAssignmentNotActive(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.TRACKING_ASSIGNMENT_NOT_ACTIVE,
    'No active Driver assignment',
    409,
  );
}

export function driverLocationInvalid(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.DRIVER_LOCATION_INVALID,
    'Driver location is invalid',
    400,
  );
}

export function driverLocationNotAllowed(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.DRIVER_LOCATION_NOT_ALLOWED,
    'Driver cannot publish location',
    409,
  );
}

export function driverLocationRateLimited(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.DRIVER_LOCATION_RATE_LIMITED,
    'Driver location updates are rate limited',
    429,
  );
}

export function driverLocationStoreUnavailable(): TrackingError {
  return new TrackingError(
    TRACKING_ERROR_CODES.DRIVER_LOCATION_STORE_UNAVAILABLE,
    'Driver location store is unavailable',
    503,
  );
}
