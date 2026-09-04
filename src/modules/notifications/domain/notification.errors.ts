import { AppError } from '../../../common/errors/app.error';

export const NOTIFICATION_ERROR_CODES = {
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  NOTIFICATION_TYPE_INVALID: 'NOTIFICATION_TYPE_INVALID',
  NOTIFICATION_SOURCE_INVALID: 'NOTIFICATION_SOURCE_INVALID',
  NOTIFICATION_CONFIGURATION_INVALID: 'NOTIFICATION_CONFIGURATION_INVALID',
  NOTIFICATION_DEVICE_TOKEN_INVALID: 'NOTIFICATION_DEVICE_TOKEN_INVALID',
  NOTIFICATION_INTEGRITY_CONFLICT: 'NOTIFICATION_INTEGRITY_CONFLICT',
} as const;

export type NotificationErrorCode =
  (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES];

export class NotificationError extends AppError {
  constructor(
    readonly code: NotificationErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'NotificationError';
  }
}

export function notificationNotFound(
  message = 'Notification not found',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_NOT_FOUND,
    message,
    404,
  );
}

export function notificationTypeInvalid(
  message = 'Notification type is invalid',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_TYPE_INVALID,
    message,
    400,
  );
}

export function notificationSourceInvalid(
  message = 'Notification source is invalid',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_SOURCE_INVALID,
    message,
    400,
  );
}

export function notificationConfigurationInvalid(
  message = 'Notification configuration is invalid',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_CONFIGURATION_INVALID,
    message,
    400,
  );
}

export function notificationDeviceTokenInvalid(
  message = 'Device push token is invalid',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_DEVICE_TOKEN_INVALID,
    message,
    400,
  );
}

export function notificationIntegrityConflict(
  message = 'Notification integrity conflict',
): NotificationError {
  return new NotificationError(
    NOTIFICATION_ERROR_CODES.NOTIFICATION_INTEGRITY_CONFLICT,
    message,
    409,
  );
}
