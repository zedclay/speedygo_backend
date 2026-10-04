import { AppError } from '../../../common/errors/app.error';

export const COMMERCE_VERTICAL_ERROR_CODES = {
  COMMERCE_VERTICAL_NOT_FOUND: 'COMMERCE_VERTICAL_NOT_FOUND',
  COMMERCE_VERTICAL_INVALID: 'COMMERCE_VERTICAL_INVALID',
  COMMERCE_VERTICAL_SLUG_CONFLICT: 'COMMERCE_VERTICAL_SLUG_CONFLICT',
  COMMERCE_VERTICAL_INACTIVE: 'COMMERCE_VERTICAL_INACTIVE',
  MERCHANT_BRANCH_CLASSIFICATION_NOT_FOUND:
    'MERCHANT_BRANCH_CLASSIFICATION_NOT_FOUND',
} as const;

export type CommerceVerticalErrorCode =
  (typeof COMMERCE_VERTICAL_ERROR_CODES)[keyof typeof COMMERCE_VERTICAL_ERROR_CODES];

export class CommerceVerticalError extends AppError {
  constructor(
    code: CommerceVerticalErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'CommerceVerticalError';
  }

  declare readonly code: CommerceVerticalErrorCode;
}

export function commerceVerticalNotFound(): CommerceVerticalError {
  return new CommerceVerticalError(
    COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_NOT_FOUND,
    'Commerce category was not found',
    404,
  );
}

export function commerceVerticalInvalid(
  message = 'Commerce category is invalid',
): CommerceVerticalError {
  return new CommerceVerticalError(
    COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_INVALID,
    message,
    400,
  );
}

export function commerceVerticalSlugConflict(): CommerceVerticalError {
  return new CommerceVerticalError(
    COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_SLUG_CONFLICT,
    'A commerce category with this slug already exists',
    409,
  );
}

export function commerceVerticalInactive(): CommerceVerticalError {
  return new CommerceVerticalError(
    COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_INACTIVE,
    'Commerce category is not active',
    404,
  );
}

export function merchantBranchClassificationNotFound(): CommerceVerticalError {
  return new CommerceVerticalError(
    COMMERCE_VERTICAL_ERROR_CODES.MERCHANT_BRANCH_CLASSIFICATION_NOT_FOUND,
    'Branch classification was not found',
    404,
  );
}
