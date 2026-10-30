import { CUSTOMER_CATALOG_ERROR_CODES } from '../domain/customer-catalog.errors';
import { CustomerCatalogService } from './customer-catalog.service';

function openingHoursStub() {
  return {
    evaluateBranches: jest.fn().mockResolvedValue(new Map()),
    getCustomerProjection: jest.fn().mockResolvedValue({
      hoursConfigured: false,
      isOpenNow: false,
      timezone: 'Africa/Algiers',
      currentClosesAt: null,
      nextOpenAt: null,
      days: [],
    }),
  };
}

function clockStub(now = new Date('2026-01-15T10:00:00.000Z')) {
  return { now: () => now };
}

describe('CustomerCatalogService.search', () => {
  it('does not call the repository for wildcard-only or empty normalized queries', async () => {
    const catalog = {
      findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
      search: jest.fn(),
    };
    const service = new CustomerCatalogService(
      catalog as never,
      openingHoursStub() as never,
      clockStub(),
      { listActive: jest.fn(), findById: jest.fn() } as never,
      { readCustomerCover: jest.fn() } as never,
      { readCustomerImage: jest.fn() } as never,
      { listCommunes: jest.fn() } as never,
    );

    for (const q of ['%%', '__', '%_%', ' % _ ', 'a%', '%']) {
      await expect(service.search('account-1', { q })).rejects.toMatchObject({
        code: CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_SEARCH_QUERY_INVALID,
      });
    }

    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('passes the fully normalized query to the repository', async () => {
    const catalog = {
      findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
      search: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      }),
    };
    const service = new CustomerCatalogService(
      catalog as never,
      openingHoursStub() as never,
      clockStub(),
      { listActive: jest.fn(), findById: jest.fn() } as never,
      { readCustomerCover: jest.fn() } as never,
      { readCustomerImage: jest.fn() } as never,
      { listCommunes: jest.fn() } as never,
    );

    await service.search('account-1', { q: '  ab%%  ' });

    expect(catalog.search).toHaveBeenCalledWith({
      query: 'ab',
      limit: 50,
      offset: 0,
      hitType: undefined,
      openNowLocal: undefined,
      coverageZoneId: undefined,
    });
  });
});

describe('CustomerCatalogService.listStorefronts coverage', () => {
  function serviceWith(
    catalog: Record<string, unknown>,
    geo: Record<string, unknown> = { listCommunes: jest.fn() },
  ) {
    return new CustomerCatalogService(
      {
        findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
        listStorefronts: jest.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }),
        ...catalog,
      } as never,
      openingHoursStub() as never,
      clockStub(),
      { listActive: jest.fn(), findById: jest.fn() } as never,
      { readCustomerCover: jest.fn() } as never,
      { readCustomerImage: jest.fn() } as never,
      geo as never,
    );
  }

  it('returns empty OUTSIDE coverage without listing when the pin is uncovered', async () => {
    const listStorefronts = jest.fn();
    const service = serviceWith({
      findOwnedAddress: jest.fn().mockResolvedValue({
        id: 'addr-1',
        latitude: 36.365,
        longitude: 6.614,
      }),
      findCoveringZones: jest.fn().mockResolvedValue([]),
      listStorefronts,
    });
    const page = await service.listStorefronts('account-1', {
      addressId: 'addr-1',
    });
    expect(page.items).toEqual([]);
    expect(page.coverage).toEqual({
      inCoverage: false,
      zoneCount: 0,
      reason: 'OUTSIDE',
    });
    expect(listStorefronts).not.toHaveBeenCalled();
  });

  it('filters listed storefronts to the covering zone and optional wilaya', async () => {
    const listStorefronts = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    const listCommunes = jest.fn().mockResolvedValue({ communes: [] });
    const service = serviceWith(
      {
        findOwnedAddress: jest.fn().mockResolvedValue({
          id: 'addr-1',
          latitude: 35.1939,
          longitude: -0.6417,
        }),
        findCoveringZones: jest
          .fn()
          .mockResolvedValue([{ id: 'zone-sba', name: 'West' }]),
        listStorefronts,
      },
      { listCommunes },
    );
    await service.listStorefronts('account-1', {
      addressId: 'addr-1',
      wilayaCode: '22',
    });
    expect(listCommunes).toHaveBeenCalledWith('22');
    expect(listStorefronts).toHaveBeenCalledWith(
      expect.objectContaining({
        coverageZoneId: 'zone-sba',
        wilayaCode: '22',
      }),
    );
  });
});

describe('CustomerCatalogService.listStorefronts openNow', () => {
  it('passes openNowLocal with verticalId and skips filter when openNow is false', async () => {
    const now = new Date('2024-01-15T10:00:00.000Z');
    const catalog = {
      findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
      listStorefronts: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      }),
    };
    const verticals = {
      listActive: jest.fn(),
      findById: jest.fn().mockResolvedValue({
        id: 'vertical-1',
        active: true,
        slug: 'food',
        name: 'Food',
        iconKey: 'restaurant',
        sortOrder: 0,
      }),
    };
    const service = new CustomerCatalogService(
      catalog as never,
      openingHoursStub() as never,
      clockStub(now),
      verticals as never,
      { readCustomerCover: jest.fn() } as never,
      { readCustomerImage: jest.fn() } as never,
      { listCommunes: jest.fn() } as never,
    );

    await service.listStorefronts('account-1', {
      verticalId: 'vertical-1',
      openNow: true,
      limit: 10,
      offset: 0,
    });
    expect(catalog.listStorefronts).toHaveBeenCalledWith(
      expect.objectContaining({
        verticalId: 'vertical-1',
        limit: 10,
        offset: 0,
        openNowLocal: expect.objectContaining({
          dayOfWeek: expect.any(Number),
          previousDayOfWeek: expect.any(Number),
          minuteOfDay: expect.any(Number),
        }),
      }),
    );

    catalog.listStorefronts.mockClear();
    await service.listStorefronts('account-1', {
      openNow: false,
      limit: 10,
      offset: 0,
    });
    expect(catalog.listStorefronts).toHaveBeenCalledWith(
      expect.objectContaining({
        openNowLocal: undefined,
      }),
    );
  });
});
