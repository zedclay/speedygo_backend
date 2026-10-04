import { AppError } from '../../../common/errors/app.error';

export const AVAILABILITY_ERROR_CODES = {
  AVAILABILITY_INVALID: 'AVAILABILITY_INVALID',
  AVAILABILITY_VERSION_CONFLICT: 'AVAILABILITY_VERSION_CONFLICT',
} as const;

export type AvailabilityErrorCode =
  (typeof AVAILABILITY_ERROR_CODES)[keyof typeof AVAILABILITY_ERROR_CODES];

export class AvailabilityError extends AppError {
  constructor(
    code: AvailabilityErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'AvailabilityError';
  }

  declare readonly code: AvailabilityErrorCode;
}

export function availabilityInvalid(
  message = 'Branch availability override is invalid',
): AvailabilityError {
  return new AvailabilityError(
    AVAILABILITY_ERROR_CODES.AVAILABILITY_INVALID,
    message,
    400,
  );
}

export function availabilityVersionConflict(
  current?: Record<string, unknown>,
): AvailabilityError {
  return new AvailabilityError(
    AVAILABILITY_ERROR_CODES.AVAILABILITY_VERSION_CONFLICT,
    'Branch availability version conflict',
    409,
    current ? { availability: current } : undefined,
  );
}
