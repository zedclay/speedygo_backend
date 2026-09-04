import { AppError } from '../../../common/errors/app.error';

export const MERCHANT_ERROR_CODES = {
  MERCHANT_NOT_FOUND: 'MERCHANT_NOT_FOUND',
  MERCHANT_BRANCH_NOT_FOUND: 'MERCHANT_BRANCH_NOT_FOUND',
  MERCHANT_BRANCH_INVALID: 'MERCHANT_BRANCH_INVALID',
  MERCHANT_ROLE_FORBIDDEN: 'MERCHANT_ROLE_FORBIDDEN',
  MERCHANT_STATUS_RESTRICTED: 'MERCHANT_STATUS_RESTRICTED',
  MERCHANT_LAST_BRANCH_REQUIRED: 'MERCHANT_LAST_BRANCH_REQUIRED',
  MERCHANT_DOCUMENT_INVALID: 'MERCHANT_DOCUMENT_INVALID',
  MERCHANT_VERIFICATION_NOT_READY: 'MERCHANT_VERIFICATION_NOT_READY',
  MERCHANT_VERIFICATION_INVALID_STATE: 'MERCHANT_VERIFICATION_INVALID_STATE',
  MERCHANT_VERIFICATION_ADMIN_REQUIRED: 'MERCHANT_VERIFICATION_ADMIN_REQUIRED',
  MERCHANT_VERIFICATION_INTEGRITY: 'MERCHANT_VERIFICATION_INTEGRITY',
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

export function merchantDocumentInvalid(
  message = 'Merchant verification document is invalid',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_DOCUMENT_INVALID,
    message,
    400,
  );
}

export function merchantVerificationNotReady(
  message = 'Merchant verification evidence is incomplete',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_NOT_READY,
    message,
    409,
  );
}

export function merchantVerificationInvalidState(
  message = 'Merchant verification state does not allow this action',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    message,
    409,
  );
}

export function merchantVerificationAdminRequired(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_ADMIN_REQUIRED,
    'Trusted AdminProfile is required for this verification review action',
    403,
  );
}

export function merchantVerificationIntegrity(
  message = 'Merchant verification evidence is corrupt or ambiguous',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INTEGRITY,
    message,
    409,
  );
}
