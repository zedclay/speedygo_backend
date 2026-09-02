import { AppError } from '../../../common/errors/app.error';

export const MATCHING_ERROR_CODES = {
  DRIVER_ASSIGNMENT_NOT_FOUND: 'DRIVER_ASSIGNMENT_NOT_FOUND',
  DRIVER_ASSIGNMENT_INVALID_STATE: 'DRIVER_ASSIGNMENT_INVALID_STATE',
  DRIVER_ASSIGNMENT_EXPIRED: 'DRIVER_ASSIGNMENT_EXPIRED',
  DRIVER_NOT_MATCHING_ELIGIBLE: 'DRIVER_NOT_MATCHING_ELIGIBLE',
  DRIVER_LOCATION_REQUIRED: 'DRIVER_LOCATION_REQUIRED',
  DRIVER_LOCATION_STALE: 'DRIVER_LOCATION_STALE',
  DRIVER_LOCATION_INVALID: 'DRIVER_LOCATION_INVALID',
  DELIVERY_NOT_SEARCHING_DRIVER: 'DELIVERY_NOT_SEARCHING_DRIVER',
  DELIVERY_ALREADY_ASSIGNED: 'DELIVERY_ALREADY_ASSIGNED',
  DRIVER_ALREADY_ASSIGNED: 'DRIVER_ALREADY_ASSIGNED',
  MATCHING_NO_ELIGIBLE_DRIVER: 'MATCHING_NO_ELIGIBLE_DRIVER',
} as const;

export type MatchingErrorCode =
  (typeof MATCHING_ERROR_CODES)[keyof typeof MATCHING_ERROR_CODES];

export class MatchingError extends AppError {
  constructor(
    code: MatchingErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'MatchingError';
  }

  declare readonly code: MatchingErrorCode;
}

export function driverAssignmentNotFound(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_NOT_FOUND,
    'Driver assignment was not found',
    404,
  );
}

export function driverAssignmentInvalidState(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_INVALID_STATE,
    'Driver assignment cannot change in the current state',
    409,
  );
}

export function driverAssignmentExpired(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_EXPIRED,
    'Driver assignment offer has expired',
    409,
  );
}

export function driverNotMatchingEligible(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_NOT_MATCHING_ELIGIBLE,
    'Driver is not eligible for matching',
    409,
  );
}

export function driverLocationRequired(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_LOCATION_REQUIRED,
    'A fresh Driver location is required',
    409,
  );
}

export function driverLocationStale(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_LOCATION_STALE,
    'Driver location is stale',
    409,
  );
}

export function driverLocationInvalid(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_LOCATION_INVALID,
    'Driver location is invalid',
    400,
  );
}

export function deliveryNotSearchingDriver(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DELIVERY_NOT_SEARCHING_DRIVER,
    'Delivery is not searching for a Driver',
    409,
  );
}

export function deliveryAlreadyAssigned(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DELIVERY_ALREADY_ASSIGNED,
    'Delivery already has an assignment',
    409,
  );
}

export function driverAlreadyAssigned(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.DRIVER_ALREADY_ASSIGNED,
    'Driver already has an open assignment',
    409,
  );
}

export function matchingNoEligibleDriver(): MatchingError {
  return new MatchingError(
    MATCHING_ERROR_CODES.MATCHING_NO_ELIGIBLE_DRIVER,
    'No eligible Driver is available',
    409,
  );
}
