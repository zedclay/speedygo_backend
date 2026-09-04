import { RATING_ERROR_CODES } from '../domain/ratings.errors';
import { RatingsService } from './ratings.service';

describe('RatingsService', () => {
  function build(repo: Record<string, jest.Mock>) {
    return new RatingsService(repo as never);
  }

  const customer = { id: 'cust-1', accountId: 'acct-1' };
  const completedOrder = {
    orderId: 'ord-1',
    customerId: 'cust-1',
    status: 'COMPLETED',
    merchantId: 'merch-1',
    merchantBranchId: 'branch-1',
  };

  it('blocks foreign Order merchant rating', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue({
        ...completedOrder,
        customerId: 'other-cust',
      }),
      createMerchantRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 5),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_NOT_FOUND,
    });
    expect(repo.createMerchantRating).not.toHaveBeenCalled();
  });

  it('rejects premature merchant rating when Order not COMPLETED', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue({
        ...completedOrder,
        status: 'ACTIVE',
      }),
      createMerchantRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 4),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_INVALID_STATE,
    });
  });

  it('rejects cancelled Order rating', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue({
        ...completedOrder,
        status: 'CANCELLED',
      }),
      createMerchantRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 1),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_INVALID_STATE,
    });
  });

  it('derives merchant from Order and ignores client merchantId', async () => {
    const created = {
      id: 'r1',
      orderId: 'ord-1',
      customerId: 'cust-1',
      merchantId: 'merch-1',
      score: 5,
      comment: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      isMerchantMember: jest.fn().mockResolvedValue(false),
      findMerchantRatingByOrderCustomer: jest.fn().mockResolvedValue(null),
      createMerchantRating: jest.fn().mockResolvedValue(created),
    };
    const service = build(repo);
    const result = await service.rateMerchant('acct-1', 'ord-1', 5, 'great');
    expect(result.merchantId).toBe('merch-1');
    expect(repo.createMerchantRating).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merch-1',
        score: 5,
        comment: 'great',
      }),
      {},
    );
  });

  it('derives driver from historical serving assignment, not client body', async () => {
    const created = {
      id: 'r2',
      orderId: 'ord-1',
      customerId: 'cust-1',
      driverId: 'drv-derived',
      score: 4,
      comment: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      findDeliveredDriverId: jest.fn().mockResolvedValue({
        deliveryId: 'del-1',
        driverId: 'drv-derived',
      }),
      findDriverProfileByAccountId: jest.fn().mockResolvedValue(null),
      findDriverRatingByOrderCustomer: jest.fn().mockResolvedValue(null),
      createDriverRating: jest.fn().mockResolvedValue(created),
    };
    const service = build(repo);
    const result = await service.rateDriver('acct-1', 'ord-1', 4);
    expect(result.driverId).toBe('drv-derived');
  });

  it('fails when historical serving Driver cannot be identified', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      findDeliveredDriverId: jest.fn().mockResolvedValue(null),
      createDriverRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateDriver('acct-1', 'ord-1', 4),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_INVALID_STATE,
    });
    expect(repo.createDriverRating).not.toHaveBeenCalled();
  });

  it('allows Driver rating independent of Merchant rating uniqueness', async () => {
    const created = {
      id: 'r3',
      orderId: 'ord-1',
      customerId: 'cust-1',
      driverId: 'drv-1',
      score: 5,
      comment: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      findDeliveredDriverId: jest.fn().mockResolvedValue({
        deliveryId: 'del-1',
        driverId: 'drv-1',
      }),
      findDriverProfileByAccountId: jest.fn().mockResolvedValue(null),
      findDriverRatingByOrderCustomer: jest.fn().mockResolvedValue(null),
      createDriverRating: jest.fn().mockResolvedValue(created),
    };
    const service = build(repo);
    await expect(
      service.rateDriver('acct-1', 'ord-1', 5),
    ).resolves.toMatchObject({ driverId: 'drv-1', score: 5 });
  });

  it('rejects invalid score', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 0),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_INVALID_INPUT,
    });
  });

  it('rejects duplicate merchant rating', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      isMerchantMember: jest.fn().mockResolvedValue(false),
      findMerchantRatingByOrderCustomer: jest.fn().mockResolvedValue({
        id: 'existing',
        orderId: 'ord-1',
        customerId: 'cust-1',
        merchantId: 'merch-1',
        score: 5,
        comment: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      createMerchantRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 3),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_ALREADY_EXISTS,
    });
    expect(repo.createMerchantRating).not.toHaveBeenCalled();
  });

  it('blocks self-rating when Customer is Merchant member', async () => {
    const repo = {
      findCustomerProfileByAccountId: jest.fn().mockResolvedValue(customer),
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockEligibleOrderContext: jest.fn().mockResolvedValue(completedOrder),
      isMerchantMember: jest.fn().mockResolvedValue(true),
      createMerchantRating: jest.fn(),
    };
    const service = build(repo);
    await expect(
      service.rateMerchant('acct-1', 'ord-1', 5),
    ).rejects.toMatchObject({
      code: RATING_ERROR_CODES.RATING_SELF_NOT_ALLOWED,
    });
  });

  it('summary returns average null when count is 0', async () => {
    const repo = {
      merchantExists: jest.fn().mockResolvedValue(true),
      aggregateMerchantRatings: jest
        .fn()
        .mockResolvedValue({ count: 0, sum: 0 }),
    };
    const service = build(repo);
    await expect(service.merchantSummary('merch-1')).resolves.toEqual({
      targetType: 'MERCHANT',
      targetId: 'merch-1',
      count: 0,
      average: null,
    });
  });

  it('summary averages with two-decimal precision', async () => {
    const repo = {
      driverExists: jest.fn().mockResolvedValue(true),
      aggregateDriverRatings: jest
        .fn()
        .mockResolvedValue({ count: 3, sum: 10 }),
    };
    const service = build(repo);
    await expect(service.driverSummary('drv-1')).resolves.toEqual({
      targetType: 'DRIVER',
      targetId: 'drv-1',
      count: 3,
      average: 3.33,
    });
  });
});
