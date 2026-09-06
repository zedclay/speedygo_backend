import {
  storageEmptyFile,
  storageFileTooLarge,
  storageInvalidSignature,
  storageUnsupportedType,
} from './storage.errors';

export const STORAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const STORAGE_MAX_FILENAME_LENGTH = 255;
export const STORAGE_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type StorageAllowedContentType =
  (typeof STORAGE_ALLOWED_CONTENT_TYPES)[number];

export type DetectedDocumentContent = {
  contentType: StorageAllowedContentType;
  extension: 'pdf' | 'jpg' | 'png';
};

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reject obvious HTML/SVG/script polyglots after a PDF header. */
function pdfLooksPolyglot(body: Buffer): boolean {
  const sample = body
    .subarray(0, Math.min(body.length, 8192))
    .toString('latin1');
  if (/<\s*(html|script|svg)\b/i.test(sample)) {
    return true;
  }
  // Trailing executable markers beyond normal PDF structure (heuristic)
  const tail = body.subarray(Math.max(0, body.length - 64)).toString('latin1');
  if (/\x4d\x5a/.test(tail) || /<!DOCTYPE\s+html/i.test(tail)) {
    return true;
  }
  return false;
}

export function detectDocumentContent(body: Buffer): DetectedDocumentContent {
  if (!body || body.length === 0) {
    throw storageEmptyFile();
  }
  if (body.length > STORAGE_MAX_BYTES) {
    throw storageFileTooLarge();
  }
  if (
    body.length >= PNG_MAGIC.length &&
    body.subarray(0, 8).equals(PNG_MAGIC)
  ) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (
    body.length >= JPEG_MAGIC.length &&
    body[0] === JPEG_MAGIC[0] &&
    body[1] === JPEG_MAGIC[1] &&
    body[2] === JPEG_MAGIC[2]
  ) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    body.length >= PDF_MAGIC.length &&
    body.subarray(0, 4).equals(PDF_MAGIC)
  ) {
    if (pdfLooksPolyglot(body)) {
      throw storageInvalidSignature('PDF content failed safety checks');
    }
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  throw storageInvalidSignature();
}

/**
 * Require declared MIME (if present) to agree with detected content.
 * Client MIME alone is never trusted.
 */
export function requireDeclaredMimeAgreement(
  detected: StorageAllowedContentType,
  declaredMime: string | undefined,
): void {
  if (!declaredMime || declaredMime.trim() === '') {
    return;
  }
  const normalized = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'image/jpg') {
    if (detected !== 'image/jpeg') {
      throw storageUnsupportedType('Declared MIME does not match file content');
    }
    return;
  }
  if (
    !STORAGE_ALLOWED_CONTENT_TYPES.includes(
      normalized as StorageAllowedContentType,
    )
  ) {
    throw storageUnsupportedType();
  }
  if (normalized !== detected) {
    throw storageUnsupportedType('Declared MIME does not match file content');
  }
}

export function assertSafeOriginalFilename(filename: string | undefined): void {
  if (filename === undefined || filename === '') {
    return;
  }
  if (filename.length > STORAGE_MAX_FILENAME_LENGTH) {
    throw storageUnsupportedType('Filename is too long');
  }
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    /^[a-zA-Z]:[\\/]/.test(filename)
  ) {
    throw storageUnsupportedType('Filename is unsafe');
  }
}
