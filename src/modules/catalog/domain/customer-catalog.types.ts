export type CustomerStorefrontHours = {
  hoursConfigured: boolean;
  isOpenNow: boolean;
  timezone: string;
  currentClosesAt: string | null;
  nextOpenAt: string | null;
};

export type CustomerStorefrontPublicDay = {
  dayOfWeek: number;
  intervals: Array<{
    opens: string;
    closes: string;
    opensMinute: number;
    closesMinute: number;
    closesNextDay: boolean;
  }>;
};

export type CustomerStorefrontSummary = {
  branchId: string;
  branchName: string;
  addressText: string;
  latitude: number;
  longitude: number;
  merchantId: string;
  merchantName: string;
  merchantPublicReference: string;
  hoursConfigured: boolean;
  isOpenNow: boolean;
  timezone: string;
  currentClosesAt: string | null;
  nextOpenAt: string | null;
};

export type CustomerStorefrontDetail = CustomerStorefrontSummary & {
  days: CustomerStorefrontPublicDay[];
};

export type CustomerCategorySummary = {
  categoryId: string;
  name: string;
  sortOrder: number;
};

export type CustomerProductSummary = {
  /** Exact Product.id accepted by POST /api/v1/customer/cart/items */
  productId: string;
  branchId: string;
  categoryId: string;
  name: string;
  description: string | null;
  /** Informational current catalog price; Checkout remains authoritative. */
  priceMinor: string;
};

export type CustomerProductOption = {
  optionId: string;
  name: string;
  additionalPriceMinor: string;
  available: boolean;
};

export type CustomerProductOptionGroup = {
  optionGroupId: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: CustomerProductOption[];
};

export type CustomerProductDetail = CustomerProductSummary & {
  optionGroups: CustomerProductOptionGroup[];
};

export type CustomerCatalogPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
};

export type CustomerCatalogSearchHit =
  | {
      type: 'STOREFRONT';
      storefront: CustomerStorefrontSummary;
    }
  | {
      type: 'PRODUCT';
      product: CustomerProductSummary;
      storefront: CustomerStorefrontSummary;
    };

export type CustomerCatalogSearchResult =
  CustomerCatalogPage<CustomerCatalogSearchHit>;
