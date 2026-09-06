import {
  isBranchOperationallyActive,
  isMerchantApproved,
  isMerchantProfileComplete,
} from '../../merchants/domain/merchant.policy';
import { isProductCustomerOfferable } from './catalog.policy';
import {
  customerCatalogInvalidPagination,
  customerSearchQueryInvalid,
} from './customer-catalog.errors';

/** Same defaults as Merchant Catalog product list / Customer order list. */
export const CUSTOMER_CATALOG_LIST_DEFAULT_LIMIT = 50;
export const CUSTOMER_CATALOG_LIST_MAX_LIMIT = 100;
export const CUSTOMER_CATALOG_LIST_MAX_OFFSET = 10_000;

export const CUSTOMER_CATALOG_SEARCH_MIN_LENGTH = 2;
export const CUSTOMER_CATALOG_SEARCH_MAX_LENGTH = 100;

export const CUSTOMER_CATALOG_SORT_NAME = 'name' as const;
export const CUSTOMER_CATALOG_ALLOWED_SORTS = [
  CUSTOMER_CATALOG_SORT_NAME,
] as const;
export type CustomerCatalogSortField =
  (typeof CUSTOMER_CATALOG_ALLOWED_SORTS)[number];

/**
 * Storefront = MerchantBranch (orderable cart/checkout scope).
 * Eligible when Merchant is operationally approved+named and this Branch is ACTIVE.
 * Does not imply openNow, deliverable, or catalog non-empty.
 */
export function isStorefrontCustomerVisible(input: {
  merchantName: string;
  merchantStatus: string;
  merchantVerifiedAt: string | null;
  branchOperationalStatus: string;
}): boolean {
  return (
    isMerchantProfileComplete(input.merchantName) &&
    isMerchantApproved(input.merchantStatus, input.merchantVerifiedAt) &&
    isBranchOperationallyActive(input.branchOperationalStatus)
  );
}

/**
 * Product is Customer-orderable iff Catalog + Merchant offerability holds.
 * merchantOperationalReady for a single Branch equals storefront visibility of that Branch
 * (profileComplete ∧ approved ∧ this Branch ACTIVE).
 */
export function isCustomerDiscoverableProduct(input: {
  merchantName: string;
  merchantStatus: string;
  merchantVerifiedAt: string | null;
  branchOperationalStatus: string;
  categoryActive: boolean;
  productAvailable: boolean;
}): boolean {
  const storefrontVisible = isStorefrontCustomerVisible({
    merchantName: input.merchantName,
    merchantStatus: input.merchantStatus,
    merchantVerifiedAt: input.merchantVerifiedAt,
    branchOperationalStatus: input.branchOperationalStatus,
  });
  return isProductCustomerOfferable({
    merchantOperationalReady: storefrontVisible,
    branchOperationalStatus: input.branchOperationalStatus,
    categoryActive: input.categoryActive,
    productAvailable: input.productAvailable,
  });
}

export function normalizeCustomerCatalogPagination(input: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const limit = input.limit ?? CUSTOMER_CATALOG_LIST_DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > CUSTOMER_CATALOG_LIST_MAX_LIMIT
  ) {
    throw customerCatalogInvalidPagination(
      `limit must be an integer between 1 and ${CUSTOMER_CATALOG_LIST_MAX_LIMIT}`,
    );
  }
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > CUSTOMER_CATALOG_LIST_MAX_OFFSET
  ) {
    throw customerCatalogInvalidPagination(
      `offset must be an integer between 0 and ${CUSTOMER_CATALOG_LIST_MAX_OFFSET}`,
    );
  }
  return { limit, offset };
}

/**
 * Customer search wildcard policy (v1.0): Policy B — remove LIKE metacharacters
 * (`%`, `_`, `\`), re-trim, then require normalized length 2..100.
 * Does not escape-as-literal. Does not allow client wildcard syntax.
 * Order: typeof check → trim → strip metacharacters → trim → length validate.
 * Case-insensitive match is applied in SQL (ILIKE contains).
 */
export function stripCustomerCatalogLikeMetacharacters(raw: string): string {
  return raw.replace(/[%_\\]/g, '');
}

/** @deprecated Prefer stripCustomerCatalogLikeMetacharacters (Policy B removal). */
export function escapeCustomerCatalogLike(raw: string): string {
  return stripCustomerCatalogLikeMetacharacters(raw);
}

export function normalizeCustomerCatalogSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw customerSearchQueryInvalid('q must be a string');
  }
  const trimmed = raw.trim();
  const stripped = stripCustomerCatalogLikeMetacharacters(trimmed);
  const normalized = stripped.trim();
  if (normalized.length < CUSTOMER_CATALOG_SEARCH_MIN_LENGTH) {
    throw customerSearchQueryInvalid(
      `q must be at least ${CUSTOMER_CATALOG_SEARCH_MIN_LENGTH} characters after trim and removal of LIKE wildcards`,
    );
  }
  if (normalized.length > CUSTOMER_CATALOG_SEARCH_MAX_LENGTH) {
    throw customerSearchQueryInvalid(
      `q must be at most ${CUSTOMER_CATALOG_SEARCH_MAX_LENGTH} characters after trim and removal of LIKE wildcards`,
    );
  }
  return normalized;
}

export function resolveCustomerCatalogSort(
  sort?: string,
): CustomerCatalogSortField {
  if (sort === undefined || sort === CUSTOMER_CATALOG_SORT_NAME) {
    return CUSTOMER_CATALOG_SORT_NAME;
  }
  throw customerCatalogInvalidPagination(
    `sort must be one of: ${CUSTOMER_CATALOG_ALLOWED_SORTS.join(', ')}`,
  );
}
