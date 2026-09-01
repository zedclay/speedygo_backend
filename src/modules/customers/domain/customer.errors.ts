import { AppError } from '../../../common/errors/app.error';

export const CUSTOMER_ERROR_CODES = {
  CUSTOMER_PROFILE_NOT_FOUND: 'CUSTOMER_PROFILE_NOT_FOUND',
  CUSTOMER_PROFILE_ALREADY_EXISTS: 'CUSTOMER_PROFILE_ALREADY_EXISTS',
  CUSTOMER_ADDRESS_NOT_FOUND: 'CUSTOMER_ADDRESS_NOT_FOUND',
  CUSTOMER_ADDRESS_INVALID: 'CUSTOMER_ADDRESS_INVALID',
  CUSTOMER_DEFAULT_ADDRESS_INVALID: 'CUSTOMER_DEFAULT_ADDRESS_INVALID',
} as const;

export type CustomerErrorCode =
  (typeof CUSTOMER_ERROR_CODES)[keyof typeof CUSTOMER_ERROR_CODES];

export class CustomerError extends AppError {
  constructor(code: CustomerErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'CustomerError';
  }

  declare readonly code: CustomerErrorCode;
}

export function customerProfileNotFound(): CustomerError {
  return new CustomerError(
    CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    'Customer profile was not found',
    404,
  );
}

export function customerProfileAlreadyExists(): CustomerError {
  return new CustomerError(
    CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_ALREADY_EXISTS,
    'Customer profile already exists',
    409,
  );
}

export function customerAddressNotFound(): CustomerError {
  return new CustomerError(
    CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
    'Address was not found',
    404,
  );
}

export function customerAddressInvalid(
  message = 'Address is invalid',
): CustomerError {
  return new CustomerError(
    CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_INVALID,
    message,
    400,
  );
}

export function customerDefaultAddressInvalid(): CustomerError {
  return new CustomerError(
    CUSTOMER_ERROR_CODES.CUSTOMER_DEFAULT_ADDRESS_INVALID,
    'Default address could not be updated',
    409,
  );
}
