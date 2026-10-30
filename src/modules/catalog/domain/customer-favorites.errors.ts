import { AppError } from '../../../common/errors/app.error';

export const CUSTOMER_FAVORITE_ERROR_CODES = {
  CUSTOMER_FAVORITE_KIND_INVALID: 'CUSTOMER_FAVORITE_KIND_INVALID',
} as const;

export class CustomerFavoriteError extends AppError {
  constructor(code: string, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'CustomerFavoriteError';
  }
}

export function customerFavoriteKindInvalid(): CustomerFavoriteError {
  return new CustomerFavoriteError(
    CUSTOMER_FAVORITE_ERROR_CODES.CUSTOMER_FAVORITE_KIND_INVALID,
    'kind must be BRANCH or PRODUCT',
    400,
  );
}
