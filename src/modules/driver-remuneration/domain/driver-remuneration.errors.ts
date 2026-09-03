import { AppError } from '../../../common/errors/app.error';

export const DRIVER_REMUNERATION_ERROR_CODES = {
  DRIVER_EARNING_NOT_FOUND: 'DRIVER_EARNING_NOT_FOUND',
  DRIVER_EARNING_ALREADY_EXISTS: 'DRIVER_EARNING_ALREADY_EXISTS',
  DRIVER_EARNING_FINANCIAL_STATE_INVALID:
    'DRIVER_EARNING_FINANCIAL_STATE_INVALID',
  DRIVER_EARNING_AMOUNT_INVALID: 'DRIVER_EARNING_AMOUNT_INVALID',
  DRIVER_EARNING_DELIVERY_NOT_COMPLETED:
    'DRIVER_EARNING_DELIVERY_NOT_COMPLETED',
  DRIVER_EARNING_ASSIGNMENT_INVALID: 'DRIVER_EARNING_ASSIGNMENT_INVALID',
} as const;

export type DriverRemunerationErrorCode =
  (typeof DRIVER_REMUNERATION_ERROR_CODES)[keyof typeof DRIVER_REMUNERATION_ERROR_CODES];

export class DriverRemunerationError extends AppError {
  constructor(
    readonly code: DriverRemunerationErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'DriverRemunerationError';
  }
}

export function driverEarningNotFound(): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_NOT_FOUND,
    'Driver earning not found',
    404,
  );
}

export function driverEarningAlreadyExists(): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_ALREADY_EXISTS,
    'Driver earning already exists for this Delivery',
    409,
  );
}

export function driverEarningFinancialStateInvalid(
  message = 'Driver earning financial state is invalid',
): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_FINANCIAL_STATE_INVALID,
    message,
    409,
  );
}

export function driverEarningAmountInvalid(): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_AMOUNT_INVALID,
    'Driver remuneration amount must be a non-negative integer minor amount',
    400,
  );
}

export function driverEarningDeliveryNotCompleted(): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_DELIVERY_NOT_COMPLETED,
    'Driver earning requires a successfully completed Delivery',
    409,
  );
}

export function driverEarningAssignmentInvalid(): DriverRemunerationError {
  return new DriverRemunerationError(
    DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_ASSIGNMENT_INVALID,
    'Driver earning requires the accepted completing Driver',
    409,
  );
}
