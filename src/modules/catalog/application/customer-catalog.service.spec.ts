import { CUSTOMER_CATALOG_ERROR_CODES } from '../domain/customer-catalog.errors';
import { CustomerCatalogService } from './customer-catalog.service';

describe('CustomerCatalogService.search', () => {
  it('does not call the repository for wildcard-only or empty normalized queries', async () => {
    const catalog = {
      findProfileIdByAccountId: jest.fn().mockResolvedValue('profile-1'),
      search: jest.fn(),
    };
    const service = new CustomerCatalogService(catalog as never);

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
    const service = new CustomerCatalogService(catalog as never);

    await service.search('account-1', { q: '  ab%%  ' });

    expect(catalog.search).toHaveBeenCalledWith({
      query: 'ab',
      limit: 50,
      offset: 0,
    });
  });
});
