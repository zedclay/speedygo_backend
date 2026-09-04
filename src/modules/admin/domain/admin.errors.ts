import { AppError } from '../../../common/errors/app.error';

export const ADMIN_ERROR_CODES = {
  ADMIN_PROFILE_REQUIRED: 'ADMIN_PROFILE_REQUIRED',
  ADMIN_ROLE_INACTIVE: 'ADMIN_ROLE_INACTIVE',
  ADMIN_AUDIT_FAILED: 'ADMIN_AUDIT_FAILED',
  ADMIN_FORBIDDEN: 'ADMIN_FORBIDDEN',
  ADMIN_NOT_FOUND: 'ADMIN_NOT_FOUND',
} as const;

export type AdminErrorCode =
  (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];

export class AdminError extends AppError {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'AdminError';
  }
}

export function adminProfileRequired(
  message = 'AdminProfile is required for this route',
): AdminError {
  return new AdminError(ADMIN_ERROR_CODES.ADMIN_PROFILE_REQUIRED, message, 403);
}

export function adminRoleInactive(
  message = 'Admin role is inactive',
): AdminError {
  return new AdminError(ADMIN_ERROR_CODES.ADMIN_ROLE_INACTIVE, message, 403);
}

export function adminAuditFailed(
  message = 'Admin mutation succeeded but audit log write failed',
): AdminError {
  return new AdminError(ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED, message, 500);
}

export function adminForbidden(
  message = 'Admin is not allowed to perform this action',
): AdminError {
  return new AdminError(ADMIN_ERROR_CODES.ADMIN_FORBIDDEN, message, 403);
}

export function adminNotFound(
  message = 'Admin resource not found',
): AdminError {
  return new AdminError(ADMIN_ERROR_CODES.ADMIN_NOT_FOUND, message, 404);
}
