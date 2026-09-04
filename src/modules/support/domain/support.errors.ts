import { AppError } from '../../../common/errors/app.error';

export const SUPPORT_ERROR_CODES = {
  SUPPORT_NOT_FOUND: 'SUPPORT_NOT_FOUND',
  SUPPORT_FORBIDDEN: 'SUPPORT_FORBIDDEN',
  SUPPORT_INVALID_STATE: 'SUPPORT_INVALID_STATE',
  SUPPORT_INVALID_INPUT: 'SUPPORT_INVALID_INPUT',
  SUPPORT_RESOURCE_FORBIDDEN: 'SUPPORT_RESOURCE_FORBIDDEN',
  SUPPORT_INTEGRITY: 'SUPPORT_INTEGRITY',
} as const;

export type SupportErrorCode =
  (typeof SUPPORT_ERROR_CODES)[keyof typeof SUPPORT_ERROR_CODES];

export class SupportError extends AppError {
  constructor(
    readonly code: SupportErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'SupportError';
  }
}

export function supportNotFound(
  message = 'Support ticket not found',
): SupportError {
  return new SupportError(SUPPORT_ERROR_CODES.SUPPORT_NOT_FOUND, message, 404);
}

export function supportForbidden(
  message = 'Support access is forbidden',
): SupportError {
  return new SupportError(SUPPORT_ERROR_CODES.SUPPORT_FORBIDDEN, message, 403);
}

export function supportInvalidState(
  message = 'Support ticket status transition is not allowed',
): SupportError {
  return new SupportError(
    SUPPORT_ERROR_CODES.SUPPORT_INVALID_STATE,
    message,
    409,
  );
}

export function supportInvalidInput(
  message = 'Support input is invalid',
): SupportError {
  return new SupportError(
    SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    message,
    400,
  );
}

export function supportResourceForbidden(
  message = 'Linked resource is not accessible for this Support ticket',
): SupportError {
  return new SupportError(
    SUPPORT_ERROR_CODES.SUPPORT_RESOURCE_FORBIDDEN,
    message,
    403,
  );
}

/** Unknown persisted status/priority outside frozen application vocabulary. */
export function supportIntegrity(
  message = 'Support ticket has corrupt or unsupported vocabulary',
): SupportError {
  return new SupportError(SUPPORT_ERROR_CODES.SUPPORT_INTEGRITY, message, 409);
}
