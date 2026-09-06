import { AppError } from '../../../common/errors/app.error';

export const STORAGE_ERROR_CODES = {
  STORAGE_UNSUPPORTED_TYPE: 'STORAGE_UNSUPPORTED_TYPE',
  STORAGE_FILE_TOO_LARGE: 'STORAGE_FILE_TOO_LARGE',
  STORAGE_EMPTY_FILE: 'STORAGE_EMPTY_FILE',
  STORAGE_INVALID_SIGNATURE: 'STORAGE_INVALID_SIGNATURE',
  STORAGE_MALFORMED_MULTIPART: 'STORAGE_MALFORMED_MULTIPART',
  STORAGE_PURPOSE_UNSUPPORTED: 'STORAGE_PURPOSE_UNSUPPORTED',
  STORAGE_UPLOAD_REFERENCE_INVALID: 'STORAGE_UPLOAD_REFERENCE_INVALID',
  STORAGE_UPLOAD_REFERENCE_FOREIGN: 'STORAGE_UPLOAD_REFERENCE_FOREIGN',
  STORAGE_OBJECT_MISSING: 'STORAGE_OBJECT_MISSING',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  STORAGE_SCAN_UNAVAILABLE: 'STORAGE_SCAN_UNAVAILABLE',
  STORAGE_SCAN_REJECTED: 'STORAGE_SCAN_REJECTED',
  STORAGE_DOWNLOAD_FORBIDDEN: 'STORAGE_DOWNLOAD_FORBIDDEN',
  STORAGE_CONFIG_INVALID: 'STORAGE_CONFIG_INVALID',
  STORAGE_LEGACY_REFERENCE_UNAVAILABLE: 'STORAGE_LEGACY_REFERENCE_UNAVAILABLE',
} as const;

export type StorageErrorCode =
  (typeof STORAGE_ERROR_CODES)[keyof typeof STORAGE_ERROR_CODES];

export class StorageError extends AppError {
  constructor(code: StorageErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'StorageError';
  }

  declare readonly code: StorageErrorCode;
}

export function storageUnsupportedType(
  message = 'File type is not allowed',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE,
    message,
    400,
  );
}

export function storageFileTooLarge(
  message = 'File exceeds the maximum allowed size',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_FILE_TOO_LARGE,
    message,
    400,
  );
}

export function storageEmptyFile(message = 'File is empty'): StorageError {
  return new StorageError(STORAGE_ERROR_CODES.STORAGE_EMPTY_FILE, message, 400);
}

export function storageInvalidSignature(
  message = 'File content signature is invalid',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_INVALID_SIGNATURE,
    message,
    400,
  );
}

export function storageMalformedMultipart(
  message = 'Multipart payload is invalid',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_MALFORMED_MULTIPART,
    message,
    400,
  );
}

export function storagePurposeUnsupported(
  message = 'Document purpose is not supported',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_PURPOSE_UNSUPPORTED,
    message,
    400,
  );
}

export function storageUploadReferenceInvalid(
  message = 'Upload reference is invalid',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_UPLOAD_REFERENCE_INVALID,
    message,
    400,
  );
}

export function storageUploadReferenceForeign(
  message = 'Upload reference is not available',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_UPLOAD_REFERENCE_FOREIGN,
    message,
    404,
  );
}

export function storageObjectMissing(
  message = 'Document content was not found',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_OBJECT_MISSING,
    message,
    404,
  );
}

export function storageUnavailable(
  message = 'Document storage is temporarily unavailable',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    message,
    503,
  );
}

export function storageScanUnavailable(
  message = 'Malware scanning is unavailable',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_SCAN_UNAVAILABLE,
    message,
    503,
  );
}

export function storageScanRejected(
  message = 'File was rejected by malware scanning',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_SCAN_REJECTED,
    message,
    400,
  );
}

export function storageDownloadForbidden(
  message = 'Document download is forbidden',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_DOWNLOAD_FORBIDDEN,
    message,
    403,
  );
}

export function storageConfigInvalid(
  message = 'Storage configuration is invalid',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_CONFIG_INVALID,
    message,
    500,
  );
}

export function storageLegacyReferenceUnavailable(
  message = 'Document content is unavailable',
): StorageError {
  return new StorageError(
    STORAGE_ERROR_CODES.STORAGE_LEGACY_REFERENCE_UNAVAILABLE,
    message,
    404,
  );
}
