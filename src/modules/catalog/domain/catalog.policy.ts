import {
  catalogInvalidPrice,
  catalogOptionGroupInvalid,
} from './catalog.errors';

export const CATALOG_NAME_MAX_LENGTH = 255;
export const CATALOG_DESCRIPTION_MAX_LENGTH = 4000;
export const CATALOG_PRICE_MINOR_MAX = 9_999_999_999;
export const CATALOG_SORT_ORDER_MIN = -100_000;
export const CATALOG_SORT_ORDER_MAX = 100_000;
export const CATALOG_SELECTION_MAX = 50;
export const CATALOG_PRODUCT_LIST_DEFAULT_LIMIT = 50;
export const CATALOG_PRODUCT_LIST_MAX_LIMIT = 100;
export const CATALOG_PRODUCT_LIST_MAX_OFFSET = 10_000;

export function requireCatalogPriceMinor(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > CATALOG_PRICE_MINOR_MAX
  ) {
    throw catalogInvalidPrice();
  }
}

export function requireOptionGroupRules(input: {
  required: boolean;
  minSelections: number;
  maxSelections: number;
}): void {
  const { required, minSelections, maxSelections } = input;
  if (
    !Number.isInteger(minSelections) ||
    !Number.isInteger(maxSelections) ||
    minSelections < 0 ||
    maxSelections < 1 ||
    maxSelections < minSelections ||
    maxSelections > CATALOG_SELECTION_MAX
  ) {
    throw catalogOptionGroupInvalid(
      'maxSelections must be >= 1, >= minSelections, and within the allowed range',
    );
  }
  if (required && minSelections < 1) {
    throw catalogOptionGroupInvalid(
      'A required option group must have minSelections >= 1',
    );
  }
  if (!required && minSelections !== 0) {
    throw catalogOptionGroupInvalid(
      'An optional option group must have minSelections = 0',
    );
  }
}

/**
 * Future customer-catalog invariant. Not a persisted column and not a
 * Customer browsing API. Opening-hours and stock remain separate.
 */
export function isProductCustomerOfferable(input: {
  merchantOperationalReady: boolean;
  branchOperationalStatus: string;
  categoryActive: boolean;
  productAvailable: boolean;
}): boolean {
  return (
    input.merchantOperationalReady &&
    input.branchOperationalStatus === 'ACTIVE' &&
    input.categoryActive &&
    input.productAvailable
  );
}

export function parseMinorUnits(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(CATALOG_PRICE_MINOR_MAX)) {
      return Number.NaN;
    }
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

export function escapeLikeContains(raw: string): string {
  return raw.replace(/[%_\\]/g, '');
}
