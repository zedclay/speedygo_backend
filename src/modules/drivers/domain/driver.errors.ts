import { AppError } from '../../../common/errors/app.error';

export const DRIVER_ERROR_CODES = {
  DRIVER_PROFILE_NOT_FOUND: 'DRIVER_PROFILE_NOT_FOUND',
  DRIVER_PROFILE_ALREADY_EXISTS: 'DRIVER_PROFILE_ALREADY_EXISTS',
  DRIVER_ONBOARDING_INCOMPLETE: 'DRIVER_ONBOARDING_INCOMPLETE',
  DRIVER_VERIFICATION_INVALID_STATE: 'DRIVER_VERIFICATION_INVALID_STATE',
  DRIVER_NOT_OPERATIONAL: 'DRIVER_NOT_OPERATIONAL',
  DRIVER_NOT_APPROVED: 'DRIVER_NOT_APPROVED',
  DRIVER_DOCUMENT_REQUIRED: 'DRIVER_DOCUMENT_REQUIRED',
  DRIVER_LICENSE_REQUIRED: 'DRIVER_LICENSE_REQUIRED',
  DRIVER_VEHICLE_REQUIRED: 'DRIVER_VEHICLE_REQUIRED',
  DRIVER_VEHICLE_NOT_FOUND: 'DRIVER_VEHICLE_NOT_FOUND',
  DRIVER_VEHICLE_CONFLICT: 'DRIVER_VEHICLE_CONFLICT',
  DRIVER_DOCUMENT_INVALID: 'DRIVER_DOCUMENT_INVALID',
  DRIVER_AVAILABILITY_INVALID_TRANSITION:
    'DRIVER_AVAILABILITY_INVALID_TRANSITION',
} as const;

export type DriverErrorCode =
  (typeof DRIVER_ERROR_CODES)[keyof typeof DRIVER_ERROR_CODES];

export class DriverError extends AppError {
  constructor(
    code: DriverErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'DriverError';
  }

  declare readonly code: DriverErrorCode;
}

export function driverProfileNotFound(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
    'Driver profile was not found',
    404,
  );
}

export function driverProfileAlreadyExists(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS,
    'Driver profile already exists',
    409,
  );
}

export function driverOnboardingIncomplete(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_ONBOARDING_INCOMPLETE,
    'Driver onboarding is incomplete',
    409,
  );
}

export function driverVerificationInvalidState(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_VERIFICATION_INVALID_STATE,
    'Driver verification cannot be submitted in the current state',
    409,
  );
}

export function driverNotOperational(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_NOT_OPERATIONAL,
    'Driver is not operational',
    409,
  );
}

export function driverNotApproved(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_NOT_APPROVED,
    'Driver is not approved',
    409,
  );
}

export function driverDocumentRequired(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_DOCUMENT_REQUIRED,
    'Identity document is required',
    409,
  );
}

export function driverLicenseRequired(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_LICENSE_REQUIRED,
    'Driving license is required',
    409,
  );
}

export function driverVehicleRequired(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_VEHICLE_REQUIRED,
    'An ACTIVE vehicle is required',
    409,
  );
}

export function driverVehicleNotFound(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_VEHICLE_NOT_FOUND,
    'Vehicle was not found',
    404,
  );
}

export function driverVehicleConflict(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_VEHICLE_CONFLICT,
    'Vehicle plate is already in use',
    409,
  );
}

export function driverDocumentInvalid(
  message = 'Driver document is invalid',
): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_DOCUMENT_INVALID,
    message,
    400,
  );
}

export function driverAvailabilityInvalidTransition(): DriverError {
  return new DriverError(
    DRIVER_ERROR_CODES.DRIVER_AVAILABILITY_INVALID_TRANSITION,
    'Driver availability cannot change in the current state',
    409,
  );
}
