import { CUSTOMER_ERROR_CODES } from '../../customers/domain/customer.errors';
import { CUSTOMER_CATALOG_ERROR_CODES } from '../domain/customer-catalog.errors';
import { CUSTOMER_FAVORITE_ERROR_CODES } from '../domain/customer-favorites.errors';
import { CustomerFavoritesService } from './customer-favorites.service';

describe('CustomerFavoritesService', () => {
  function service(overrides: {
    favorites?: Record<string, unknown>;
    catalog?: Record<string, unknown>;
    discovery?: Record<string, unknown>;
  }) {
    return new CustomerFavoritesService(
      {
        insert: jest.fn(),
        deleteOwned: jest.fn().mockResolvedValue(true),
        listOwned: jest.fn().mockResolvedValue([]),
        listOwnedIds: jest.fn().mockResolvedValue({
          branchIds: [],
          productIds: [],
        }),
        findVisibleBranchId: jest.fn().mockResolvedValue('branch-1'),
        findVisibleProduct: jest.fn().mockResolvedValue({
          productId: 'prod-1',
          branchId: 'branch-1',
        }),
        ...overrides.favorites,
      } as never,
      {
        findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
        ...overrides.catalog,
      } as never,
      {
        getStorefront: jest.fn(),
        getProduct: jest.fn(),
        resolveOwnedPinCoverage: jest.fn().mockResolvedValue({
          coverage: { inCoverage: true, zoneCount: 0, reason: 'UNFILTERED' },
        }),
        coverageForStorefront: jest.fn(
          async (
            storefront: { branchId?: string },
            pin: { coverage: { reason: string } },
          ) => pin.coverage,
        ),
        ...overrides.discovery,
      } as never,
    );
  }

  it('rejects unknown favorite kind', async () => {
    const svc = service({});
    await expect(svc.list('account-1', 'MERCHANT')).rejects.toMatchObject({
      code: CUSTOMER_FAVORITE_ERROR_CODES.CUSTOMER_FAVORITE_KIND_INVALID,
    });
  });

  it('does not insert a hidden branch', async () => {
    const insert = jest.fn();
    const svc = service({
      favorites: {
        findVisibleBranchId: jest.fn().mockResolvedValue(null),
        insert,
      },
    });
    await expect(svc.addBranch('account-1', 'branch-missing')).rejects.toMatchObject({
      code: CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts a visible branch for the signed-in profile only', async () => {
    const insert = jest.fn().mockResolvedValue({});
    const svc = service({ favorites: { insert } });
    await expect(svc.addBranch('account-1', 'branch-1')).resolves.toEqual({
      ok: true,
    });
    expect(insert).toHaveBeenCalledWith({
      customerId: 'profile-1',
      targetKind: 'BRANCH',
      targetId: 'branch-1',
      branchId: 'branch-1',
    });
  });

  it('omits stale storefronts from the list', async () => {
    const svc = service({
      favorites: {
        listOwned: jest.fn().mockResolvedValue([
          {
            id: 'fav-1',
            customerId: 'profile-1',
            targetKind: 'BRANCH',
            targetId: 'gone',
            branchId: 'gone',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
      discovery: {
        getStorefront: jest.fn().mockRejectedValue(new Error('gone')),
      },
    });
    await expect(svc.list('account-1', 'BRANCH')).resolves.toEqual({
      kind: 'BRANCH',
      branches: [],
      products: [],
    });
  });

  it('annotates live pin coverage and rejects an unowned address', async () => {
    const storefront = {
      branchId: 'branch-1',
      branchName: 'Cafe',
      addressText: '1 rue',
      latitude: 35.19,
      longitude: -0.64,
      merchantId: 'm1',
      merchantName: 'Cafe SARL',
      merchantPublicReference: 'SG-M-1',
      coverImageUrl: null,
      hoursConfigured: true,
      isOpenNow: true,
      timezone: 'Africa/Algiers',
      currentClosesAt: null,
      nextOpenAt: null,
    };
    const coverageForStorefront = jest.fn().mockResolvedValue({
      inCoverage: false,
      zoneCount: 0,
      reason: 'OUTSIDE',
    });
    const inside = service({
      favorites: {
        listOwned: jest.fn().mockResolvedValue([
          {
            id: 'fav-1',
            customerId: 'profile-1',
            targetKind: 'BRANCH',
            targetId: 'branch-1',
            branchId: 'branch-1',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
      discovery: {
        getStorefront: jest.fn().mockResolvedValue(storefront),
        resolveOwnedPinCoverage: jest.fn().mockResolvedValue({
          coverage: { inCoverage: true, zoneCount: 1, reason: 'INSIDE' },
          zoneId: 'zone-hydra',
        }),
        coverageForStorefront,
      },
    });
    await expect(
      inside.list('account-1', 'BRANCH', 'addr-hydra'),
    ).resolves.toEqual({
      kind: 'BRANCH',
      branches: [
        {
          ...storefront,
          coverage: { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' },
        },
      ],
      products: [],
    });
    expect(coverageForStorefront).toHaveBeenCalled();

    const missing = service({
      discovery: {
        resolveOwnedPinCoverage: jest.fn().mockRejectedValue({
          code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
        }),
      },
    });
    await expect(
      missing.list('account-1', 'BRANCH', 'addr-foreign'),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
    });
  });
});
