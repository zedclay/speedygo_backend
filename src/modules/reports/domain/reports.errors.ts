import { AppError } from '../../../common/errors/app.error';

export const REPORTS_ERROR_CODES = {
  REPORTS_INVALID_INPUT: 'REPORTS_INVALID_INPUT',
  REPORTS_FORBIDDEN: 'REPORTS_FORBIDDEN',
} as const;

export type ReportsErrorCode =
  (typeof REPORTS_ERROR_CODES)[keyof typeof REPORTS_ERROR_CODES];

export class ReportsError extends AppError {
  constructor(
    readonly code: ReportsErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'ReportsError';
  }
}

export function reportsInvalidInput(message: string): ReportsError {
  return new ReportsError(
    REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT,
    message,
    400,
  );
}

export function reportsForbidden(
  message = 'Reports access is forbidden',
): ReportsError {
  return new ReportsError(REPORTS_ERROR_CODES.REPORTS_FORBIDDEN, message, 403);
}
