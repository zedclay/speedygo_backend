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
  MERCHANT_REJECTION_ISSUES_INVALID: 'MERCHANT_REJECTION_ISSUES_INVALID',
  LEGAL_ACCEPTANCE_REQUIRED: 'LEGAL_ACCEPTANCE_REQUIRED',
  LEGAL_VERSION_OUTDATED: 'LEGAL_VERSION_OUTDATED',
  TEAM_INVALID_INPUT: 'TEAM_INVALID_INPUT',
  TEAM_OWNER_PROTECTED: 'TEAM_OWNER_PROTECTED',
  TEAM_SELF_FORBIDDEN: 'TEAM_SELF_FORBIDDEN',
  TEAM_DUPLICATE_MEMBER: 'TEAM_DUPLICATE_MEMBER',
  TEAM_DUPLICATE_INVITE: 'TEAM_DUPLICATE_INVITE',
  TEAM_INVITE_NOT_FOUND: 'TEAM_INVITE_NOT_FOUND',
  TEAM_INVITE_EXPIRED: 'TEAM_INVITE_EXPIRED',
  TEAM_INVITE_CODE_INVALID: 'TEAM_INVITE_CODE_INVALID',
  TEAM_PHONE_MISMATCH: 'TEAM_PHONE_MISMATCH',
  TEAM_VERSION_CONFLICT: 'TEAM_VERSION_CONFLICT',
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

export function legalAcceptanceRequired(
  message = 'Acceptance of the current legal documents is required',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.LEGAL_ACCEPTANCE_REQUIRED,
    message,
    400,
  );
}

export function legalVersionOutdated(
  message = 'A legal document version is no longer current',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.LEGAL_VERSION_OUTDATED,
    message,
    400,
  );
}

export function merchantRejectionIssuesInvalid(
  message = 'Rejection issues are invalid',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_REJECTION_ISSUES_INVALID,
    message,
    400,
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

export function teamInvalidInput(
  message = 'Team request is invalid',
): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_INVALID_INPUT,
    message,
    400,
  );
}

export function teamOwnerProtected(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED,
    'The OWNER membership cannot be assigned, changed or revoked through team management',
    403,
  );
}

export function teamSelfForbidden(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_SELF_FORBIDDEN,
    'You cannot revoke or demote your own membership',
    403,
  );
}

export function teamDuplicateMember(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_DUPLICATE_MEMBER,
    'This Account is already a member of the Merchant',
    409,
  );
}

export function teamDuplicateInvite(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_DUPLICATE_INVITE,
    'A pending invitation already exists for this phone',
    409,
  );
}

export function teamInviteNotFound(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND,
    'Invitation was not found',
    404,
  );
}

export function teamInviteExpired(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_INVITE_EXPIRED,
    'Invitation has expired',
    409,
  );
}

export function teamInviteCodeInvalid(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_INVITE_CODE_INVALID,
    'Invitation code is invalid',
    400,
  );
}

export function teamPhoneMismatch(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_PHONE_MISMATCH,
    'Invitation does not match the authenticated phone',
    403,
  );
}

export function teamVersionConflict(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT,
    'Team record was modified; reload and retry',
    409,
  );
}

/** Unknown member of this Merchant; reuses MERCHANT_NOT_FOUND (no new code). */
export function teamMemberNotFound(): MerchantError {
  return new MerchantError(
    MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    'Team member was not found',
    404,
  );
}
