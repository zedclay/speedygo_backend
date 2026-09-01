import { AppError } from '../../../common/errors/app.error';

export const CART_ERROR_CODES = {
  CART_ITEM_NOT_FOUND: 'CART_ITEM_NOT_FOUND',
  CART_BRANCH_MISMATCH: 'CART_BRANCH_MISMATCH',
  CART_PRODUCT_NOT_AVAILABLE: 'CART_PRODUCT_NOT_AVAILABLE',
  CART_OPTION_NOT_AVAILABLE: 'CART_OPTION_NOT_AVAILABLE',
  CART_OPTION_INVALID: 'CART_OPTION_INVALID',
  CART_REQUIRED_OPTION_MISSING: 'CART_REQUIRED_OPTION_MISSING',
  CART_INVALID_QUANTITY: 'CART_INVALID_QUANTITY',
} as const;

export type CartErrorCode =
  (typeof CART_ERROR_CODES)[keyof typeof CART_ERROR_CODES];

export class CartError extends AppError {
  constructor(code: CartErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'CartError';
  }

  declare readonly code: CartErrorCode;
}

export function cartItemNotFound(): CartError {
  return new CartError(
    CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
    'Cart item was not found',
    404,
  );
}

export function cartBranchMismatch(): CartError {
  return new CartError(
    CART_ERROR_CODES.CART_BRANCH_MISMATCH,
    'Active Cart already belongs to a different Branch',
    409,
  );
}

export function cartProductNotAvailable(
  message = 'Product is not available for this Cart',
  httpStatus = 409,
): CartError {
  return new CartError(
    CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    message,
    httpStatus,
  );
}

export function cartOptionNotAvailable(): CartError {
  return new CartError(
    CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE,
    'Selected option is not available',
    409,
  );
}

export function cartOptionInvalid(
  message = 'Option selection is invalid for this Product',
): CartError {
  return new CartError(CART_ERROR_CODES.CART_OPTION_INVALID, message, 400);
}

export function cartRequiredOptionMissing(): CartError {
  return new CartError(
    CART_ERROR_CODES.CART_REQUIRED_OPTION_MISSING,
    'Required option group selections are missing',
    400,
  );
}

export function cartInvalidQuantity(
  message = 'Quantity must be an integer from 1 to 99',
): CartError {
  return new CartError(CART_ERROR_CODES.CART_INVALID_QUANTITY, message, 400);
}
