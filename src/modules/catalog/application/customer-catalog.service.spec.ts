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
    );

    await service.search('account-1', { q: '  ab%%  ' });

    expect(catalog.search).toHaveBeenCalledWith({
      query: 'ab',
      limit: 50,
      offset: 0,
    });
  });
});
