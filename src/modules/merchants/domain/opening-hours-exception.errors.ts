import { AppError } from '../../../common/errors/app.error';

export const OPENING_HOURS_EXCEPTION_ERROR_CODES = {
  OPENING_HOURS_EXCEPTION_INVALID: 'OPENING_HOURS_EXCEPTION_INVALID',
  OPENING_HOURS_EXCEPTION_VERSION_CONFLICT:
    'OPENING_HOURS_EXCEPTION_VERSION_CONFLICT',
  OPENING_HOURS_EXCEPTION_NOT_FOUND: 'OPENING_HOURS_EXCEPTION_NOT_FOUND',
  OPENING_HOURS_EXCEPTION_WEEKLY_REQUIRED:
    'OPENING_HOURS_EXCEPTION_WEEKLY_REQUIRED',
} as const;

export type OpeningHoursExceptionErrorCode =
  (typeof OPENING_HOURS_EXCEPTION_ERROR_CODES)[keyof typeof OPENING_HOURS_EXCEPTION_ERROR_CODES];

export class OpeningHoursExceptionError extends AppError {
  constructor(
    code: OpeningHoursExceptionErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'OpeningHoursExceptionError';
  }

  declare readonly code: OpeningHoursExceptionErrorCode;
}

export function openingHoursExceptionInvalid(
  message = 'Opening hours exception is invalid',
): OpeningHoursExceptionError {
  return new OpeningHoursExceptionError(
    OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_INVALID,
    message,
    400,
  );
}

/** `current` is the stored exception for the date, or null when none exists. */
export function openingHoursExceptionVersionConflict(
  current: Record<string, unknown> | null,
): OpeningHoursExceptionError {
  return new OpeningHoursExceptionError(
    OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_VERSION_CONFLICT,
    'Opening hours exception changed; reload and retry',
    409,
    { openingHoursException: current },
  );
}

export function openingHoursExceptionNotFound(): OpeningHoursExceptionError {
  return new OpeningHoursExceptionError(
    OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_NOT_FOUND,
    'No opening hours exception exists for this date',
    404,
  );
}

export function openingHoursExceptionWeeklyRequired(): OpeningHoursExceptionError {
  return new OpeningHoursExceptionError(
    OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_WEEKLY_REQUIRED,
    'Configure weekly opening hours before adding exceptions',
    409,
  );
}
