import { AppError } from '../../../common/errors/app.error';

export const CATALOG_ERROR_CODES = {
  CATALOG_CATEGORY_NOT_FOUND: 'CATALOG_CATEGORY_NOT_FOUND',
  CATALOG_PRODUCT_NOT_FOUND: 'CATALOG_PRODUCT_NOT_FOUND',
  CATALOG_OPTION_GROUP_NOT_FOUND: 'CATALOG_OPTION_GROUP_NOT_FOUND',
  CATALOG_OPTION_NOT_FOUND: 'CATALOG_OPTION_NOT_FOUND',
  CATALOG_INVALID_PRICE: 'CATALOG_INVALID_PRICE',
  CATALOG_CATEGORY_IN_USE: 'CATALOG_CATEGORY_IN_USE',
  CATALOG_PRODUCT_IN_USE: 'CATALOG_PRODUCT_IN_USE',
  CATALOG_OPTION_GROUP_INVALID: 'CATALOG_OPTION_GROUP_INVALID',
} as const;

export type CatalogErrorCode =
  (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

export class CatalogError extends AppError {
  constructor(code: CatalogErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'CatalogError';
  }

  declare readonly code: CatalogErrorCode;
}

export function catalogCategoryNotFound(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_CATEGORY_NOT_FOUND,
    'Category was not found',
    404,
  );
}

export function catalogProductNotFound(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_PRODUCT_NOT_FOUND,
    'Product was not found',
    404,
  );
}

export function catalogOptionGroupNotFound(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_NOT_FOUND,
    'Option group was not found',
    404,
  );
}

export function catalogOptionNotFound(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_OPTION_NOT_FOUND,
    'Option was not found',
    404,
  );
}

export function catalogInvalidPrice(
  message = 'Price must be a non-negative integer in minor units',
): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
    message,
    400,
  );
}

export function catalogCategoryInUse(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_CATEGORY_IN_USE,
    'Category cannot be deleted while Products reference it',
    409,
  );
}

export function catalogProductInUse(): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_PRODUCT_IN_USE,
    'Product cannot be deleted after historical order use. Set available=false instead.',
    409,
  );
}

export function catalogOptionGroupInvalid(
  message = 'Option group selection rules are invalid',
): CatalogError {
  return new CatalogError(
    CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
    message,
    400,
  );
}
