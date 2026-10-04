import {
  COVER_MAX_BYTES,
  COVER_MAX_DIMENSION_PX,
  COVER_MIN_DIMENSION_PX,
} from './cover-media.policy';

export const PRODUCT_IMAGE_PURPOSE = 'PRODUCT_IMAGE';
export const PRODUCT_IMAGE_LOCATOR_PREFIX = 'sg-product-image:v1:';
export const PRODUCT_IMAGE_NAMESPACE = 'product-images/';
export const PRODUCT_IMAGE_MAX_BYTES = COVER_MAX_BYTES;
export const PRODUCT_IMAGE_MIN_DIMENSION_PX = COVER_MIN_DIMENSION_PX;
export const PRODUCT_IMAGE_MAX_DIMENSION_PX = COVER_MAX_DIMENSION_PX;

export function productImageObjectKey(objectId: string): string {
  return `${PRODUCT_IMAGE_NAMESPACE}${objectId}`;
}

export function toProductImageLocator(objectId: string): string {
  return `${PRODUCT_IMAGE_LOCATOR_PREFIX}${objectId}`;
}

export function parseProductImageLocator(ref: string): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(PRODUCT_IMAGE_LOCATOR_PREFIX)) {
    return null;
  }
  const id = ref.slice(PRODUCT_IMAGE_LOCATOR_PREFIX.length).trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    return null;
  }
  return id.toLowerCase();
}

export function customerProductImagePath(
  branchId: string,
  productId: string,
): string {
  return `/customer/branches/${branchId}/products/${productId}/image`;
}
