export const CUSTOMER_FAVORITE_KIND_BRANCH = 'BRANCH' as const;
export const CUSTOMER_FAVORITE_KIND_PRODUCT = 'PRODUCT' as const;

export const CUSTOMER_FAVORITE_KINDS = [
  CUSTOMER_FAVORITE_KIND_BRANCH,
  CUSTOMER_FAVORITE_KIND_PRODUCT,
] as const;

export type CustomerFavoriteKind = (typeof CUSTOMER_FAVORITE_KINDS)[number];

export type CustomerFavoriteRecord = {
  id: string;
  customerId: string;
  targetKind: CustomerFavoriteKind;
  targetId: string;
  branchId: string;
  createdAt: string;
};
