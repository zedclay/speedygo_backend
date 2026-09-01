import { CATALOG_ERROR_CODES } from './catalog.errors';
import {
  isProductCustomerOfferable,
  requireCatalogPriceMinor,
  requireOptionGroupRules,
} from './catalog.policy';

function codeOf(run: () => void): string {
  try {
    run();
    throw new Error('expected throw');
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe('Catalog policy', () => {
  it('accepts zero and integer minor-unit prices', () => {
    expect(() => requireCatalogPriceMinor(0)).not.toThrow();
    expect(() => requireCatalogPriceMinor(1099)).not.toThrow();
  });

  it('rejects negative, float, and oversized prices', () => {
    expect(codeOf(() => requireCatalogPriceMinor(-1))).toBe(
      CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
    );
    expect(codeOf(() => requireCatalogPriceMinor(10.99))).toBe(
      CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
    );
  });

  it('accepts valid required and optional option groups', () => {
    expect(() =>
      requireOptionGroupRules({
        required: true,
        minSelections: 1,
        maxSelections: 1,
      }),
    ).not.toThrow();
    expect(() =>
      requireOptionGroupRules({
        required: true,
        minSelections: 1,
        maxSelections: 3,
      }),
    ).not.toThrow();
    expect(() =>
      requireOptionGroupRules({
        required: false,
        minSelections: 0,
        maxSelections: 2,
      }),
    ).not.toThrow();
  });

  it('rejects invalid option group selection rules', () => {
    expect(
      codeOf(() =>
        requireOptionGroupRules({
          required: true,
          minSelections: 0,
          maxSelections: 1,
        }),
      ),
    ).toBe(CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID);
    expect(
      codeOf(() =>
        requireOptionGroupRules({
          required: false,
          minSelections: 1,
          maxSelections: 2,
        }),
      ),
    ).toBe(CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID);
    expect(
      codeOf(() =>
        requireOptionGroupRules({
          required: false,
          minSelections: 0,
          maxSelections: 0,
        }),
      ),
    ).toBe(CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID);
    expect(
      codeOf(() =>
        requireOptionGroupRules({
          required: true,
          minSelections: 3,
          maxSelections: 1,
        }),
      ),
    ).toBe(CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID);
  });

  it('requires merchant, branch, category, and product conditions for customer offerability', () => {
    expect(
      isProductCustomerOfferable({
        merchantOperationalReady: true,
        branchOperationalStatus: 'ACTIVE',
        categoryActive: true,
        productAvailable: true,
      }),
    ).toBe(true);
    expect(
      isProductCustomerOfferable({
        merchantOperationalReady: true,
        branchOperationalStatus: 'ACTIVE',
        categoryActive: false,
        productAvailable: true,
      }),
    ).toBe(false);
    expect(
      isProductCustomerOfferable({
        merchantOperationalReady: true,
        branchOperationalStatus: 'ACTIVE',
        categoryActive: true,
        productAvailable: false,
      }),
    ).toBe(false);
    expect(
      isProductCustomerOfferable({
        merchantOperationalReady: false,
        branchOperationalStatus: 'ACTIVE',
        categoryActive: true,
        productAvailable: true,
      }),
    ).toBe(false);
    expect(
      isProductCustomerOfferable({
        merchantOperationalReady: true,
        branchOperationalStatus: 'INACTIVE',
        categoryActive: true,
        productAvailable: true,
      }),
    ).toBe(false);
  });
});
