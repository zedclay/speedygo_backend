import {
  catalogInvalidPrice,
  catalogOptionGroupInvalid,
  catalogSellingUnitInvalid,
} from './catalog.errors';

export const SELLING_UNIT_CODES = [
  'PLAT',
  'PIECE',
  'PORTION',
  'BOITE',
  'PACK',
  'PLATEAU',
  'CUSTOM',
] as const;

export type SellingUnitCode = (typeof SELLING_UNIT_CODES)[number];

export const SELLING_UNIT_CUSTOM_LABEL_MAX_LENGTH = 64;

const SELLING_UNIT_FIXED_LABELS_FR: Record<
  Exclude<SellingUnitCode, 'CUSTOM'>,
  string
> = {
  PLAT: 'Plat',
  PIECE: 'Pièce',
  PORTION: 'Portion',
  BOITE: 'Boîte',
  PACK: 'Pack familial',
  PLATEAU: 'Plateau',
};

export type SellingUnitStored = {
  sellingUnitCode: SellingUnitCode | null;
  sellingUnitLabelFr: string | null;
};

export function isSellingUnitCode(value: unknown): value is SellingUnitCode {
  return (
    typeof value === 'string' &&
    (SELLING_UNIT_CODES as readonly string[]).includes(value)
  );
}

/**
 * Validates a (code, label) pair and returns the values to persist.
 * Non-CUSTOM codes never persist a label (server owns the FR label).
 * A null code is legacy / no suffix.
 */
export function normalizeSellingUnit(input: {
  sellingUnitCode: string | null;
  sellingUnitLabelFr?: string | null;
}): SellingUnitStored {
  const code = input.sellingUnitCode;
  const rawLabel = input.sellingUnitLabelFr;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0
      ? rawLabel.trim()
      : null;
  if (code === null) {
    if (label !== null) {
      throw catalogSellingUnitInvalid(
        'sellingUnitLabelFr requires sellingUnitCode CUSTOM',
      );
    }
    return { sellingUnitCode: null, sellingUnitLabelFr: null };
  }
  if (!isSellingUnitCode(code)) {
    throw catalogSellingUnitInvalid(
      `sellingUnitCode must be one of: ${SELLING_UNIT_CODES.join(', ')}`,
    );
  }
  if (code === 'CUSTOM') {
    if (label === null) {
      throw catalogSellingUnitInvalid(
        'sellingUnitLabelFr is required when sellingUnitCode is CUSTOM',
      );
    }
    if (label.length > SELLING_UNIT_CUSTOM_LABEL_MAX_LENGTH) {
      throw catalogSellingUnitInvalid(
        `sellingUnitLabelFr must be at most ${SELLING_UNIT_CUSTOM_LABEL_MAX_LENGTH} characters`,
      );
    }
    return { sellingUnitCode: 'CUSTOM', sellingUnitLabelFr: label };
  }
  if (label !== null) {
    throw catalogSellingUnitInvalid(
      'sellingUnitLabelFr is only allowed when sellingUnitCode is CUSTOM',
    );
  }
  return { sellingUnitCode: code, sellingUnitLabelFr: null };
}

/**
 * Resolves the selling unit to persist for a Product update. Returns
 * undefined when the request does not touch the selling unit.
 */
export function resolveSellingUnitUpdate(
  input: {
    sellingUnitCode?: string | null;
    sellingUnitLabelFr?: string | null;
  },
  existing: SellingUnitStored,
): SellingUnitStored | undefined {
  if (
    input.sellingUnitCode === undefined &&
    input.sellingUnitLabelFr === undefined
  ) {
    return undefined;
  }
  if (input.sellingUnitCode === undefined) {
    return normalizeSellingUnit({
      sellingUnitCode: existing.sellingUnitCode,
      sellingUnitLabelFr: input.sellingUnitLabelFr,
    });
  }
  return normalizeSellingUnit({
    sellingUnitCode: input.sellingUnitCode,
    sellingUnitLabelFr: input.sellingUnitLabelFr,
  });
}

/** Display label for a stored selling unit; null for legacy (no code). */
export function resolveSellingUnitLabelFr(
  stored: SellingUnitStored,
): string | null {
  const code = stored.sellingUnitCode;
  if (code === null || !isSellingUnitCode(code)) {
    return null;
  }
  if (code === 'CUSTOM') {
    return stored.sellingUnitLabelFr;
  }
  return SELLING_UNIT_FIXED_LABELS_FR[code];
}

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
