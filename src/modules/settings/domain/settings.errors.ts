import { AppError } from '../../../common/errors/app.error';

export const SETTINGS_ERROR_CODES = {
  SETTING_NOT_SUPPORTED: 'SETTING_NOT_SUPPORTED',
  SETTING_INVALID_VALUE: 'SETTING_INVALID_VALUE',
  SETTING_FORBIDDEN: 'SETTING_FORBIDDEN',
  SETTING_INTEGRITY: 'SETTING_INTEGRITY',
} as const;

export type SettingsErrorCode =
  (typeof SETTINGS_ERROR_CODES)[keyof typeof SETTINGS_ERROR_CODES];

export class SettingsError extends AppError {
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'SettingsError';
  }
}

export function settingNotSupported(message: string): SettingsError {
  return new SettingsError(
    SETTINGS_ERROR_CODES.SETTING_NOT_SUPPORTED,
    message,
    404,
  );
}

export function settingInvalidValue(message: string): SettingsError {
  return new SettingsError(
    SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
    message,
    400,
  );
}

export function settingForbidden(
  message = 'Settings access is forbidden',
): SettingsError {
  return new SettingsError(
    SETTINGS_ERROR_CODES.SETTING_FORBIDDEN,
    message,
    403,
  );
}

export function settingIntegrity(message: string): SettingsError {
  return new SettingsError(
    SETTINGS_ERROR_CODES.SETTING_INTEGRITY,
    message,
    500,
  );
}
