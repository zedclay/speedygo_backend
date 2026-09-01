export {
  CATALOG_DESCRIPTION_MAX_LENGTH,
  CATALOG_NAME_MAX_LENGTH,
  CATALOG_PRICE_MINOR_MAX,
  CATALOG_PRODUCT_LIST_DEFAULT_LIMIT,
  CATALOG_PRODUCT_LIST_MAX_LIMIT,
  CATALOG_PRODUCT_LIST_MAX_OFFSET,
  CATALOG_SELECTION_MAX,
  CATALOG_SORT_ORDER_MAX,
  CATALOG_SORT_ORDER_MIN,
} from './catalog.policy';

export type CategoryRecord = {
  id: string;
  merchantBranchId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductRecord = {
  id: string;
  merchantBranchId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OptionGroupRecord = {
  id: string;
  productId: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  createdAt: string;
  updatedAt: string;
};

export type OptionRecord = {
  id: string;
  optionGroupId: string;
  name: string;
  additionalPriceMinor: number;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateCategoryInput = {
  name: string;
  sortOrder?: number;
  active?: boolean;
};

export type UpdateCategoryInput = {
  name?: string;
  sortOrder?: number;
  active?: boolean;
};

export type CreateProductInput = {
  categoryId: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  available?: boolean;
};

export type UpdateProductInput = {
  categoryId?: string;
  name?: string;
  description?: string | null;
  priceMinor?: number;
  available?: boolean;
};

export type CreateOptionGroupInput = {
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
};

export type UpdateOptionGroupInput = {
  name?: string;
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
};

export type CreateOptionInput = {
  name: string;
  additionalPriceMinor: number;
  available?: boolean;
};

export type UpdateOptionInput = {
  name?: string;
  additionalPriceMinor?: number;
  available?: boolean;
};

export type ProductListQuery = {
  categoryId?: string;
  available?: boolean;
  q?: string;
  limit: number;
  offset: number;
};

export type CatalogStats = {
  categoryCount: number;
  productCount: number;
  availableProductCount: number;
};

export type CategoryView = {
  id: string;
  branchId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductSummaryView = {
  id: string;
  branchId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OptionView = {
  id: string;
  name: string;
  additionalPriceMinor: number;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OptionGroupView = {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  createdAt: string;
  updatedAt: string;
  options: OptionView[];
};

export type ProductDetailView = ProductSummaryView & {
  optionGroups: OptionGroupView[];
};

export type ProductListView = {
  items: ProductSummaryView[];
  limit: number;
  offset: number;
  total: number;
};

export type CatalogBootstrapView = {
  branchId: string;
  stats: CatalogStats;
  categories: CategoryView[];
};

export function toCategoryView(row: CategoryRecord): CategoryView {
  return {
    id: row.id,
    branchId: row.merchantBranchId,
    name: row.name,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProductSummaryView(row: ProductRecord): ProductSummaryView {
  return {
    id: row.id,
    branchId: row.merchantBranchId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    available: row.available,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toOptionView(row: OptionRecord): OptionView {
  return {
    id: row.id,
    name: row.name,
    additionalPriceMinor: row.additionalPriceMinor,
    available: row.available,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toOptionGroupView(
  row: OptionGroupRecord,
  options: OptionRecord[],
): OptionGroupView {
  return {
    id: row.id,
    name: row.name,
    required: row.required,
    minSelections: row.minSelections,
    maxSelections: row.maxSelections,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    options: options.map(toOptionView),
  };
}
