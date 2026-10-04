import { storageInvalidSignature, storageUnsupportedType } from './storage.errors';

export const COVER_PURPOSE = 'MERCHANT_BRANCH_COVER';
export const COVER_LOCATOR_PREFIX = 'sg-cover:v1:';
export const COVER_NAMESPACE = 'covers/';
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_MIN_DIMENSION_PX = 400;
export const COVER_MAX_DIMENSION_PX = 4096;

export const LOGO_PURPOSE = 'MERCHANT_BRANCH_LOGO';
export const LOGO_LOCATOR_PREFIX = 'sg-logo:v1:';
export const LOGO_NAMESPACE = 'logos/';
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIN_DIMENSION_PX = 128;
export const LOGO_MAX_DIMENSION_PX = 2048;

export const COVER_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type CoverContentType = (typeof COVER_ALLOWED_CONTENT_TYPES)[number];

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type DetectedCoverImage = {
  contentType: CoverContentType;
  extension: 'jpg' | 'png';
  widthPx: number;
  heightPx: number;
};

export function coverObjectKey(objectId: string): string {
  return `${COVER_NAMESPACE}${objectId}`;
}

export function toCoverLocator(objectId: string): string {
  return `${COVER_LOCATOR_PREFIX}${objectId}`;
}

export function parseCoverLocator(ref: string): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(COVER_LOCATOR_PREFIX)) {
    return null;
  }
  const id = ref.slice(COVER_LOCATOR_PREFIX.length).trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    return null;
  }
  return id.toLowerCase();
}

export function customerCoverImagePath(branchId: string): string {
  return `/customer/branches/${branchId}/cover`;
}

export function logoObjectKey(objectId: string): string {
  return `${LOGO_NAMESPACE}${objectId}`;
}

export function toLogoLocator(objectId: string): string {
  return `${LOGO_LOCATOR_PREFIX}${objectId}`;
}

export function merchantLogoImagePath(merchantId: string, branchId: string): string {
  return `/merchant/${merchantId}/branches/${branchId}/logo`;
}

export function assertLogoDimensions(widthPx: number, heightPx: number): void {
  if (
    widthPx < LOGO_MIN_DIMENSION_PX ||
    heightPx < LOGO_MIN_DIMENSION_PX ||
    widthPx > LOGO_MAX_DIMENSION_PX ||
    heightPx > LOGO_MAX_DIMENSION_PX
  ) {
    throw storageUnsupportedType(
      `Logo dimensions must be between ${LOGO_MIN_DIMENSION_PX} and ${LOGO_MAX_DIMENSION_PX} pixels`,
    );
  }
}

export function detectCoverImage(
  body: Buffer,
  subject: 'Cover' | 'Logo' = 'Cover',
): DetectedCoverImage {
  if (
    body.length >= PNG_MAGIC.length &&
    body.subarray(0, 8).equals(PNG_MAGIC)
  ) {
    const dims = readPngSize(body);
    return { contentType: 'image/png', extension: 'png', ...dims };
  }
  if (
    body.length >= JPEG_MAGIC.length &&
    body[0] === JPEG_MAGIC[0] &&
    body[1] === JPEG_MAGIC[1] &&
    body[2] === JPEG_MAGIC[2]
  ) {
    const dims = readJpegSize(body);
    return { contentType: 'image/jpeg', extension: 'jpg', ...dims };
  }
  throw storageUnsupportedType(`${subject} must be JPEG or PNG`);
}

export function assertCoverDimensions(widthPx: number, heightPx: number): void {
  if (
    widthPx < COVER_MIN_DIMENSION_PX ||
    heightPx < COVER_MIN_DIMENSION_PX ||
    widthPx > COVER_MAX_DIMENSION_PX ||
    heightPx > COVER_MAX_DIMENSION_PX
  ) {
    throw storageUnsupportedType(
      `Cover dimensions must be between ${COVER_MIN_DIMENSION_PX} and ${COVER_MAX_DIMENSION_PX} pixels`,
    );
  }
}

function readPngSize(body: Buffer): { widthPx: number; heightPx: number } {
  if (body.length < 24) {
    throw storageInvalidSignature('PNG header is truncated');
  }
  const widthPx = body.readUInt32BE(16);
  const heightPx = body.readUInt32BE(20);
  if (widthPx < 1 || heightPx < 1) {
    throw storageInvalidSignature('PNG dimensions are invalid');
  }
  return { widthPx, heightPx };
}

function readJpegSize(body: Buffer): { widthPx: number; heightPx: number } {
  let offset = 2;
  while (offset + 9 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = body[offset + 1];
    if (marker === undefined) {
      break;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = body.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > body.length) {
      break;
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const heightPx = body.readUInt16BE(offset + 5);
      const widthPx = body.readUInt16BE(offset + 7);
      if (widthPx < 1 || heightPx < 1) {
        throw storageInvalidSignature('JPEG dimensions are invalid');
      }
      return { widthPx, heightPx };
    }
    offset += 2 + length;
  }
  throw storageInvalidSignature('JPEG SOF marker was not found');
}
