import { AppError } from '../../../common/errors/app.error';

export const ADMIN_RBAC_ERROR_CODES = {
  ADMIN_RBAC_NOT_FOUND: 'ADMIN_RBAC_NOT_FOUND',
  ADMIN_RBAC_INVALID_INPUT: 'ADMIN_RBAC_INVALID_INPUT',
  ADMIN_RBAC_DUPLICATE: 'ADMIN_RBAC_DUPLICATE',
  ADMIN_RBAC_SELF_FORBIDDEN: 'ADMIN_RBAC_SELF_FORBIDDEN',
  ADMIN_RBAC_PRIVILEGE_GRANT_FORBIDDEN: 'ADMIN_RBAC_PRIVILEGE_GRANT_FORBIDDEN',
  ADMIN_RBAC_LAST_MANAGER_PROTECTED: 'ADMIN_RBAC_LAST_MANAGER_PROTECTED',
} as const;

export type AdminRbacErrorCode =
  (typeof ADMIN_RBAC_ERROR_CODES)[keyof typeof ADMIN_RBAC_ERROR_CODES];

export class AdminRbacError extends AppError {
  constructor(
    readonly code: AdminRbacErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'AdminRbacError';
  }
}

export function adminRbacNotFound(message = 'Admin RBAC resource not found') {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_NOT_FOUND,
    message,
    404,
  );
}

export function adminRbacInvalidInput(message: string) {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_INVALID_INPUT,
    message,
    400,
  );
}

export function adminRbacDuplicate(message: string) {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_DUPLICATE,
    message,
    409,
  );
}

export function adminRbacSelfForbidden(message: string) {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_SELF_FORBIDDEN,
    message,
    403,
  );
}

export function adminRbacPrivilegeGrantForbidden(message: string) {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_PRIVILEGE_GRANT_FORBIDDEN,
    message,
    403,
  );
}

export function adminRbacLastManagerProtected(message: string) {
  return new AdminRbacError(
    ADMIN_RBAC_ERROR_CODES.ADMIN_RBAC_LAST_MANAGER_PROTECTED,
    message,
    409,
  );
}
