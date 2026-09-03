import { AppError } from '../../../common/errors/app.error';

export const COD_ERROR_CODES = {
  DRIVER_COD_COLLECTION_ASSIGNMENT_NOT_ACTIVE:
    'DRIVER_COD_COLLECTION_ASSIGNMENT_NOT_ACTIVE',
  DRIVER_COD_COLLECTION_NOT_READY: 'DRIVER_COD_COLLECTION_NOT_READY',
  DRIVER_COD_COLLECTION_METHOD_NOT_COD: 'DRIVER_COD_COLLECTION_METHOD_NOT_COD',
  DRIVER_COD_COLLECTION_PAYMENT_NOT_ELIGIBLE:
    'DRIVER_COD_COLLECTION_PAYMENT_NOT_ELIGIBLE',
  DRIVER_COD_COLLECTION_AMOUNT_MISMATCH:
    'DRIVER_COD_COLLECTION_AMOUNT_MISMATCH',
  DRIVER_COD_COLLECTION_ALREADY_EXISTS: 'DRIVER_COD_COLLECTION_ALREADY_EXISTS',
  DRIVER_COD_COLLECTION_INCONSISTENT_STATE:
    'DRIVER_COD_COLLECTION_INCONSISTENT_STATE',
  DRIVER_COD_PROFILE_NOT_FOUND: 'DRIVER_COD_PROFILE_NOT_FOUND',
  DRIVER_COD_REMITTANCE_NOT_FOUND: 'DRIVER_COD_REMITTANCE_NOT_FOUND',
  DRIVER_COD_REMITTANCE_ALREADY_CONFIRMED:
    'DRIVER_COD_REMITTANCE_ALREADY_CONFIRMED',
  DRIVER_COD_REMITTANCE_INSUFFICIENT_CUSTODY:
    'DRIVER_COD_REMITTANCE_INSUFFICIENT_CUSTODY',
  DRIVER_COD_REMITTANCE_INVALID_AMOUNT: 'DRIVER_COD_REMITTANCE_INVALID_AMOUNT',
  DRIVER_COD_REMITTANCE_OPEN_EXISTS: 'DRIVER_COD_REMITTANCE_OPEN_EXISTS',
  DRIVER_COD_REMITTANCE_INVALID_STATE: 'DRIVER_COD_REMITTANCE_INVALID_STATE',
} as const;

export type CodErrorCode =
  (typeof COD_ERROR_CODES)[keyof typeof COD_ERROR_CODES];

export class CodError extends AppError {
  constructor(
    readonly code: CodErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'CodError';
  }
}

export function driverCodCollectionAssignmentNotActive(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_ASSIGNMENT_NOT_ACTIVE,
    'Driver has no active accepted delivery assignment',
    409,
  );
}

export function driverCodCollectionNotReady(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_NOT_READY,
    'COD collection is not ready (delivery is not in ARRIVED_CUSTOMER)',
    409,
  );
}

export function driverCodCollectionMethodNotCod(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_METHOD_NOT_COD,
    'Payment method is not COD',
    409,
  );
}

export function driverCodCollectionPaymentNotEligible(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_PAYMENT_NOT_ELIGIBLE,
    'Payment is not eligible for COD collection',
    409,
  );
}

export function driverCodCollectionAmountMismatch(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_AMOUNT_MISMATCH,
    'Collected amount does not match the authoritative expected COD amount',
    409,
  );
}

export function driverCodCollectionAlreadyExists(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_ALREADY_EXISTS,
    'COD collection already exists for this order with a conflicting amount',
    409,
  );
}

export function driverCodCollectionInconsistentState(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_COLLECTION_INCONSISTENT_STATE,
    'COD Payment is SUCCEEDED without a valid CodCollection',
    409,
  );
}

export function driverCodProfileNotFound(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_PROFILE_NOT_FOUND,
    'Driver profile was not found',
    404,
  );
}

export function driverCodRemittanceNotFound(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_NOT_FOUND,
    'COD remittance was not found',
    404,
  );
}

export function driverCodRemittanceAlreadyConfirmed(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_ALREADY_CONFIRMED,
    'COD remittance is already confirmed',
    409,
  );
}

export function driverCodRemittanceInsufficientCustody(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INSUFFICIENT_CUSTODY,
    'Driver does not have enough outstanding COD custody for this remittance',
    409,
  );
}

export function driverCodRemittanceInvalidAmount(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INVALID_AMOUNT,
    'COD remittance amount must be a positive integer minor unit',
    400,
  );
}

export function driverCodRemittanceOpenExists(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_OPEN_EXISTS,
    'Driver already has an open DECLARED remittance',
    409,
  );
}

export function driverCodRemittanceInvalidState(): CodError {
  return new CodError(
    COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INVALID_STATE,
    'COD remittance is not in a confirmable state',
    409,
  );
}
