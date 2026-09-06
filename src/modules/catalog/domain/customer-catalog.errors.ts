import { AppError } from '../../../common/errors/app.error';

export const CUSTOMER_CATALOG_ERROR_CODES = {
  CUSTOMER_STOREFRONT_NOT_FOUND: 'CUSTOMER_STOREFRONT_NOT_FOUND',
  CUSTOMER_PRODUCT_NOT_FOUND: 'CUSTOMER_PRODUCT_NOT_FOUND',
  CUSTOMER_CATEGORY_NOT_FOUND: 'CUSTOMER_CATEGORY_NOT_FOUND',
  CUSTOMER_SEARCH_QUERY_INVALID: 'CUSTOMER_SEARCH_QUERY_INVALID',
  CUSTOMER_CATALOG_INVALID_PAGINATION: 'CUSTOMER_CATALOG_INVALID_PAGINATION',
} as const;

export type CustomerCatalogErrorCode =
  (typeof CUSTOMER_CATALOG_ERROR_CODES)[keyof typeof CUSTOMER_CATALOG_ERROR_CODES];

export class CustomerCatalogError extends AppError {
  constructor(
    code: CustomerCatalogErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'CustomerCatalogError';
  }

  declare readonly code: CustomerCatalogErrorCode;
}

/** Fail-closed: same envelope whether missing or not Customer-visible. */
export function customerStorefrontNotFound(): CustomerCatalogError {
  return new CustomerCatalogError(
    CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND,
    'Storefront was not found',
    404,
  );
}

export function customerProductNotFound(): CustomerCatalogError {
  return new CustomerCatalogError(
    CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_PRODUCT_NOT_FOUND,
    'Product was not found',
    404,
  );
}

export function customerCategoryNotFound(): CustomerCatalogError {
  return new CustomerCatalogError(
    CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_CATEGORY_NOT_FOUND,
    'Category was not found',
    404,
  );
}

export function customerSearchQueryInvalid(
  message = 'Search query is invalid',
): CustomerCatalogError {
  return new CustomerCatalogError(
    CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_SEARCH_QUERY_INVALID,
    message,
    400,
  );
}

export function customerCatalogInvalidPagination(
  message = 'Pagination parameters are invalid',
): CustomerCatalogError {
  return new CustomerCatalogError(
    CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_CATALOG_INVALID_PAGINATION,
    message,
    400,
  );
}
