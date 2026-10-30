import {
  coverageForBranchAgainstPin,
  escapeCustomerCatalogLike,
  isCustomerDiscoverableProduct,
  isStorefrontCustomerVisible,
  normalizeCustomerCatalogPagination,
  normalizeCustomerCatalogSearchQuery,
  resolvePinCoverage,
  stripCustomerCatalogLikeMetacharacters,
} from './customer-catalog.policy';
import {
  CUSTOMER_CATALOG_ERROR_CODES,
  CustomerCatalogError,
} from './customer-catalog.errors';

function expectSearchInvalid(raw: unknown): void {
  expect(() => normalizeCustomerCatalogSearchQuery(raw)).toThrow(
    CustomerCatalogError,
  );
  try {
    normalizeCustomerCatalogSearchQuery(raw);
  } catch (error) {
    expect((error as CustomerCatalogError).code).toBe(
      CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_SEARCH_QUERY_INVALID,
    );
  }
}

describe('customer-catalog.policy', () => {
  it('exposes only ACTIVE verified named Merchants with ACTIVE Branches', () => {
    expect(
      isStorefrontCustomerVisible({
        merchantName: 'Cafe',
        merchantStatus: 'ACTIVE',
        merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
        branchOperationalStatus: 'ACTIVE',
      }),
    ).toBe(true);

    expect(
      isStorefrontCustomerVisible({
        merchantName: 'Cafe',
        merchantStatus: 'PENDING_REVIEW',
        merchantVerifiedAt: null,
        branchOperationalStatus: 'ACTIVE',
      }),
    ).toBe(false);

    expect(
      isStorefrontCustomerVisible({
        merchantName: 'Cafe',
        merchantStatus: 'REJECTED',
        merchantVerifiedAt: null,
        branchOperationalStatus: 'ACTIVE',
      }),
    ).toBe(false);

    expect(
      isStorefrontCustomerVisible({
        merchantName: 'Cafe',
        merchantStatus: 'SUSPENDED',
        merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
        branchOperationalStatus: 'ACTIVE',
      }),
    ).toBe(false);

    expect(
      isStorefrontCustomerVisible({
        merchantName: 'Cafe',
        merchantStatus: 'ACTIVE',
        merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
        branchOperationalStatus: 'INACTIVE',
      }),
    ).toBe(false);
  });

  it('requires full offerability for discoverable products', () => {
    const base = {
      merchantName: 'Cafe',
      merchantStatus: 'ACTIVE',
      merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
      branchOperationalStatus: 'ACTIVE',
      categoryActive: true,
      productAvailable: true,
    };
    expect(isCustomerDiscoverableProduct(base)).toBe(true);
    expect(
      isCustomerDiscoverableProduct({ ...base, productAvailable: false }),
    ).toBe(false);
    expect(
      isCustomerDiscoverableProduct({ ...base, categoryActive: false }),
    ).toBe(false);
  });

  describe('search normalization (Policy B)', () => {
    it('accepts a normal term', () => {
      expect(normalizeCustomerCatalogSearchQuery('coffee')).toBe('coffee');
    });

    it('trims leading and trailing spaces', () => {
      expect(normalizeCustomerCatalogSearchQuery('  ab  ')).toBe('ab');
    });

    it('preserves case for the normalized term (case-insensitivity is SQL ILIKE)', () => {
      expect(normalizeCustomerCatalogSearchQuery('CoFfEe')).toBe('CoFfEe');
    });

    it('rejects single LIKE metacharacters', () => {
      expectSearchInvalid('%');
      expectSearchInvalid('_');
    });

    it('rejects wildcard-only queries', () => {
      expectSearchInvalid('%%');
      expectSearchInvalid('__');
      expectSearchInvalid('%_%');
    });

    it('rejects spaces plus wildcards that normalize empty', () => {
      expectSearchInvalid(' % _ ');
      expectSearchInvalid('  %%  ');
    });

    it('rejects one valid character plus wildcards', () => {
      expectSearchInvalid('a%');
      expectSearchInvalid('%a');
      expectSearchInvalid('a__');
      expectSearchInvalid('_b_');
    });

    it('accepts valid text containing wildcards after stripping', () => {
      expect(normalizeCustomerCatalogSearchQuery('ab%%')).toBe('ab');
      expect(normalizeCustomerCatalogSearchQuery('a%b_c\\d')).toBe('abcd');
      expect(stripCustomerCatalogLikeMetacharacters('a%b_c\\d')).toBe('abcd');
      expect(escapeCustomerCatalogLike('a%b_c\\d')).toBe('abcd');
    });

    it('rejects normalized value below minimum', () => {
      expectSearchInvalid('a');
      expectSearchInvalid(' ');
      expectSearchInvalid('');
    });

    it('rejects normalized value above maximum', () => {
      expectSearchInvalid('x'.repeat(101));
      // 101 letters plus wildcards still too long after strip
      expectSearchInvalid(`${'x'.repeat(101)}%%%`);
    });

    it('accepts boundary lengths after normalization', () => {
      expect(normalizeCustomerCatalogSearchQuery('xy')).toBe('xy');
      expect(normalizeCustomerCatalogSearchQuery('x'.repeat(100))).toBe(
        'x'.repeat(100),
      );
      expect(normalizeCustomerCatalogSearchQuery(`%${'x'.repeat(100)}%`)).toBe(
        'x'.repeat(100),
      );
    });
  });

  it('resolves pin coverage without a wilaya guess', () => {
    expect(resolvePinCoverage({ coordinatesValid: false, zones: [] })).toEqual({
      coverage: { inCoverage: true, zoneCount: 0, reason: 'UNFILTERED' },
    });
    expect(
      resolvePinCoverage({
        addressId: 'addr-1',
        coordinatesValid: false,
        zones: [],
      }),
    ).toEqual({
      coverage: { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' },
    });
    expect(
      resolvePinCoverage({
        addressId: 'addr-1',
        coordinatesValid: true,
        zones: [],
      }),
    ).toEqual({
      coverage: { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' },
    });
    expect(
      resolvePinCoverage({
        addressId: 'addr-1',
        coordinatesValid: true,
        zones: [
          { id: 'z1' },
          { id: 'z2' },
        ],
      }),
    ).toEqual({
      coverage: { inCoverage: false, zoneCount: 2, reason: 'AMBIGUOUS' },
    });
    expect(
      resolvePinCoverage({
        addressId: 'addr-1',
        coordinatesValid: true,
        zones: [{ id: 'z-sba' }],
      }),
    ).toEqual({
      coverage: { inCoverage: true, zoneCount: 1, reason: 'INSIDE' },
      zoneId: 'z-sba',
    });
  });

  it('annotates a branch only against the pin zone, not a stored flag', () => {
    const inside = resolvePinCoverage({
      addressId: 'addr-1',
      coordinatesValid: true,
      zones: [{ id: 'z-sba' }],
    });
    expect(
      coverageForBranchAgainstPin({
        pin: inside,
        branchZoneIds: ['z-sba'],
      }),
    ).toEqual({ inCoverage: true, zoneCount: 1, reason: 'INSIDE' });
    expect(
      coverageForBranchAgainstPin({
        pin: inside,
        branchZoneIds: ['z-other'],
      }),
    ).toEqual({ inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' });
    expect(
      coverageForBranchAgainstPin({
        pin: { coverage: { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' } },
        branchZoneIds: ['z-sba'],
      }),
    ).toEqual({ inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' });
  });

  it('bounds pagination', () => {
    expect(normalizeCustomerCatalogPagination({})).toEqual({
      limit: 50,
      offset: 0,
    });
    expect(() => normalizeCustomerCatalogPagination({ limit: 0 })).toThrow(
      CustomerCatalogError,
    );
    expect(() => normalizeCustomerCatalogPagination({ offset: -1 })).toThrow(
      CustomerCatalogError,
    );
  });
});
