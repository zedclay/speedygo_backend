import { AppError } from '../../../common/errors/app.error';

export const MERCHANT_ERROR_CODES = {
  MERCHANT_NOT_FOUND: 'MERCHANT_NOT_FOUND',
  MERCHANT_BRANCH_NOT_FOUND: 'MERCHANT_BRANCH_NOT_FOUND',
  MERCHANT_BRANCH_INVALID: 'MERCHANT_BRANCH_INVALID',
  MERCHANT_ROLE_FORBIDDEN: 'MERCHANT_ROLE_FORBIDDEN',
  MERCHANT_STATUS_RESTRICTED: 'MERCHANT_STATUS_RESTRICTED',
  MERCHANT_LAST_BRANCH_REQUIRED: 'MERCHANT_LAST_BRANCH_REQUIRED',
} as const;

export type MerchantErrorCode =
  (typeof MERCHANT_ERROR_CODES)[keyof typeof MERCHANT_ERROR_CODES];

export class MerchantError extends AppError {
  constructor(code: MerchantErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'MerchantError';
  }

  declare readonly code: MerchantErrorCode;
}

export function merchantNotFound(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    'Merchant was not found',
    404,
  );
}

export function merchantBranchNotFound(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
    'Branch was not found',
    404,
  );
}

export function merchantBranchInvalid(
  message = 'Branch is invalid',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_BRANCH_INVALID,
    message,
    400,
  );
}

export function merchantRoleForbidden(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    'Merchant membership cannot perform this action',
    403,
  );
}

export function merchantStatusRestricted(
  message = 'Merchant status does not allow this action',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    message,
    409,
  );
}

export function merchantLastBranchRequired(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_LAST_BRANCH_REQUIRED,
    'An approved Merchant must keep at least one Branch',
    409,
  );
}
