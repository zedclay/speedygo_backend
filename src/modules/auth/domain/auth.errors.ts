import { AppError } from '../../../common/errors/app.error';

export const AUTH_ERROR_CODES = {
  AUTH_INVALID_IDENTIFIER: 'AUTH_INVALID_IDENTIFIER',
  AUTH_INVALID_OTP: 'AUTH_INVALID_OTP',
  AUTH_OTP_EXPIRED: 'AUTH_OTP_EXPIRED',
  AUTH_OTP_ATTEMPTS_EXCEEDED: 'AUTH_OTP_ATTEMPTS_EXCEEDED',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_MISCONFIGURED: 'AUTH_MISCONFIGURED',
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export class AuthError extends AppError {
  constructor(code: AuthErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'AuthError';
  }

  declare readonly code: AuthErrorCode;
}

export function authInvalidIdentifier(
  message = 'Invalid identifier',
): AuthError {
  return new AuthError(AUTH_ERROR_CODES.AUTH_INVALID_IDENTIFIER, message, 400);
}

export function authInvalidOtp(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_INVALID_OTP,
    'Verification failed',
    401,
  );
}

export function authOtpExpired(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_OTP_EXPIRED,
    'Verification failed',
    401,
  );
}

export function authOtpAttemptsExceeded(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_OTP_ATTEMPTS_EXCEEDED,
    'Verification failed',
    401,
  );
}

export function authRateLimited(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_RATE_LIMITED,
    'Too many requests',
    429,
  );
}

export function authInvalidToken(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_INVALID_TOKEN,
    'Authentication required',
    401,
  );
}

export function authSessionRevoked(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_SESSION_REVOKED,
    'Authentication required',
    401,
  );
}

export function authSessionExpired(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_SESSION_EXPIRED,
    'Authentication required',
    401,
  );
}

export function authAccountBlocked(
  status: 'SUSPENDED' | 'DISABLED',
): AuthError {
  return new AuthError(
    status === 'SUSPENDED'
      ? AUTH_ERROR_CODES.AUTH_ACCOUNT_SUSPENDED
      : AUTH_ERROR_CODES.AUTH_ACCOUNT_DISABLED,
    'Account is not allowed to authenticate',
    403,
  );
}

export function authForbidden(): AuthError {
  return new AuthError(
    AUTH_ERROR_CODES.AUTH_FORBIDDEN,
    'Insufficient permissions',
    403,
  );
}
