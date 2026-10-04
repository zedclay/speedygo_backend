import { AppError } from '../../../common/errors/app.error';

export const PICKUP_HANDOFF_ERROR_CODES = {
  PICKUP_HANDOFF_NOT_FOUND: 'PICKUP_HANDOFF_NOT_FOUND',
  PICKUP_HANDOFF_INVALID_STATE: 'PICKUP_HANDOFF_INVALID_STATE',
  PICKUP_HANDOFF_CODE_INVALID: 'PICKUP_HANDOFF_CODE_INVALID',
  PICKUP_HANDOFF_EXPIRED: 'PICKUP_HANDOFF_EXPIRED',
  PICKUP_HANDOFF_LOCKED: 'PICKUP_HANDOFF_LOCKED',
  PICKUP_HANDOFF_ALREADY_CONSUMED: 'PICKUP_HANDOFF_ALREADY_CONSUMED',
  PICKUP_HANDOFF_ASSIGNMENT_CONFLICT: 'PICKUP_HANDOFF_ASSIGNMENT_CONFLICT',
  PICKUP_HANDOFF_RATE_LIMITED: 'PICKUP_HANDOFF_RATE_LIMITED',
} as const;

export type PickupHandoffErrorCode =
  (typeof PICKUP_HANDOFF_ERROR_CODES)[keyof typeof PICKUP_HANDOFF_ERROR_CODES];

export class PickupHandoffError extends AppError {
  constructor(
    code: PickupHandoffErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'PickupHandoffError';
  }

  declare readonly code: PickupHandoffErrorCode;
}

export function pickupHandoffNotFound(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_NOT_FOUND,
    'Pickup handoff was not found',
    404,
  );
}

export function pickupHandoffInvalidState(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_INVALID_STATE,
    'Pickup handoff is not eligible in the current Delivery state',
    409,
  );
}

export function pickupHandoffCodeInvalid(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_CODE_INVALID,
    'Pickup handoff code is missing or invalid',
    409,
  );
}

export function pickupHandoffExpired(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_EXPIRED,
    'Pickup handoff code has expired',
    409,
  );
}

export function pickupHandoffLocked(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_LOCKED,
    'Pickup handoff verification is temporarily locked',
    429,
  );
}

export function pickupHandoffAlreadyConsumed(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_ALREADY_CONSUMED,
    'Pickup handoff was already consumed',
    409,
  );
}

export function pickupHandoffAssignmentConflict(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_ASSIGNMENT_CONFLICT,
    'Pickup handoff assignment does not match the current Driver assignment',
    409,
  );
}

export function pickupHandoffRateLimited(): PickupHandoffError {
  return new PickupHandoffError(
    PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_RATE_LIMITED,
    'Pickup handoff verification attempts exceeded',
    429,
  );
}
