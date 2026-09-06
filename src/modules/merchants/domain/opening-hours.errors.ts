import { AppError } from '../../../common/errors/app.error';

export const OPENING_HOURS_ERROR_CODES = {
  OPENING_HOURS_INVALID: 'OPENING_HOURS_INVALID',
  OPENING_HOURS_VERSION_CONFLICT: 'OPENING_HOURS_VERSION_CONFLICT',
  OPENING_HOURS_NOT_FOUND: 'OPENING_HOURS_NOT_FOUND',
} as const;

export type OpeningHoursErrorCode =
  (typeof OPENING_HOURS_ERROR_CODES)[keyof typeof OPENING_HOURS_ERROR_CODES];

export class OpeningHoursError extends AppError {
  constructor(
    code: OpeningHoursErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'OpeningHoursError';
  }

  declare readonly code: OpeningHoursErrorCode;
}

export function openingHoursInvalid(
  message = 'Opening hours schedule is invalid',
): OpeningHoursError {
  return new OpeningHoursError(
    OPENING_HOURS_ERROR_CODES.OPENING_HOURS_INVALID,
    message,
    400,
  );
}

export function openingHoursVersionConflict(): OpeningHoursError {
  return new OpeningHoursError(
    OPENING_HOURS_ERROR_CODES.OPENING_HOURS_VERSION_CONFLICT,
    'Opening hours version conflict',
    409,
  );
}

export function openingHoursNotFound(): OpeningHoursError {
  return new OpeningHoursError(
    OPENING_HOURS_ERROR_CODES.OPENING_HOURS_NOT_FOUND,
    'Opening hours schedule was not found',
    404,
  );
}
