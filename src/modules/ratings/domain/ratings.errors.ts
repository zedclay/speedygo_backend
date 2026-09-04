import { AppError } from '../../../common/errors/app.error';

export const RATING_ERROR_CODES = {
  RATING_NOT_FOUND: 'RATING_NOT_FOUND',
  RATING_FORBIDDEN: 'RATING_FORBIDDEN',
  RATING_INVALID_STATE: 'RATING_INVALID_STATE',
  RATING_INVALID_INPUT: 'RATING_INVALID_INPUT',
  RATING_ALREADY_EXISTS: 'RATING_ALREADY_EXISTS',
  RATING_SELF_NOT_ALLOWED: 'RATING_SELF_NOT_ALLOWED',
  RATING_INTEGRITY: 'RATING_INTEGRITY',
} as const;

export type RatingErrorCode =
  (typeof RATING_ERROR_CODES)[keyof typeof RATING_ERROR_CODES];

export class RatingError extends AppError {
  constructor(
    readonly code: RatingErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'RatingError';
  }
}

export function ratingNotFound(message = 'Rating not found'): RatingError {
  return new RatingError(RATING_ERROR_CODES.RATING_NOT_FOUND, message, 404);
}

export function ratingForbidden(
  message = 'Rating access is forbidden',
): RatingError {
  return new RatingError(RATING_ERROR_CODES.RATING_FORBIDDEN, message, 403);
}

export function ratingInvalidState(
  message = 'Order or Delivery is not eligible for rating',
): RatingError {
  return new RatingError(RATING_ERROR_CODES.RATING_INVALID_STATE, message, 409);
}

export function ratingInvalidInput(
  message = 'Rating input is invalid',
): RatingError {
  return new RatingError(RATING_ERROR_CODES.RATING_INVALID_INPUT, message, 400);
}

export function ratingAlreadyExists(
  message = 'A rating already exists for this Order and direction',
): RatingError {
  return new RatingError(
    RATING_ERROR_CODES.RATING_ALREADY_EXISTS,
    message,
    409,
  );
}

export function ratingSelfNotAllowed(
  message = 'Self-rating is not allowed',
): RatingError {
  return new RatingError(
    RATING_ERROR_CODES.RATING_SELF_NOT_ALLOWED,
    message,
    409,
  );
}

export function ratingIntegrity(
  message = 'Rating data is corrupt or ambiguous',
): RatingError {
  return new RatingError(RATING_ERROR_CODES.RATING_INTEGRITY, message, 409);
}
