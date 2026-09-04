import { PromotionService } from './promotion.service';
import { PROMOTION_ERROR_CODES } from '../domain/promotion.errors';
import { PROMOTION_TYPE_MERCHANT_RATE_BPS } from '../domain/promotion.types';

describe('PromotionService', () => {
  let repo: {
    findByNormalizedCode: jest.Mock;
    findById: jest.Mock;
    createPromotion: jest.Mock;
    setActive: jest.Mock;
    lockPromotion: jest.Mock;
    countRedemptionsForOrder: jest.Mock;
    createRedemption: jest.Mock;
    listRedemptionsForOrder: jest.Mock;
  };
  let service: PromotionService;
  const tx = { query: jest.fn() };

  beforeEach(() => {
    repo = {
      findByNormalizedCode: jest.fn(),
      findById: jest.fn(),
      createPromotion: jest.fn(),
      setActive: jest.fn(),
      lockPromotion: jest.fn().mockResolvedValue(undefined),
      countRedemptionsForOrder: jest.fn().mockResolvedValue(0),
      createRedemption: jest.fn(),
      listRedemptionsForOrder: jest.fn().mockResolvedValue([]),
    };
    service = new PromotionService(repo as never);
  });

  const promo = {
    id: 'promo-1',
    code: 'SAVE10',
    type: PROMOTION_TYPE_MERCHANT_RATE_BPS,
    value: 1000,
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    active: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };

  it('evaluates preview without creating a redemption', async () => {
    repo.findByNormalizedCode.mockResolvedValue(promo);
    const decision = await service.evaluateForPreview({
      code: 'save10',
      eligibleBaseMinor: 10000,
      decisionAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(decision.discountAmountMinor).toBe(1000);
    expect(repo.createRedemption).not.toHaveBeenCalled();
  });

  it('redeems atomically with lock and one redemption', async () => {
    repo.findByNormalizedCode.mockResolvedValue(promo);
    repo.findById.mockResolvedValue(promo);
    repo.createRedemption.mockResolvedValue({
      id: 'red-1',
      promotionId: promo.id,
      customerId: 'cust-1',
      orderId: 'ord-1',
      discountAmountMinor: 1000,
      fundedBy: 'MERCHANT',
      redeemedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await service.redeemForOrder(
      {
        code: 'SAVE10',
        eligibleBaseMinor: 10000,
        decisionAt: new Date('2026-01-01T00:00:00.000Z'),
        customerId: 'cust-1',
        orderId: 'ord-1',
      },
      tx,
    );
    expect(repo.lockPromotion).toHaveBeenCalledWith(promo.id, tx);
    expect(result.redemption.id).toBe('red-1');
    expect(repo.createRedemption).toHaveBeenCalledTimes(1);
  });

  it('rejects stacking when order already has a redemption', async () => {
    repo.countRedemptionsForOrder.mockResolvedValue(1);
    await expect(
      service.redeemForOrder(
        {
          code: 'SAVE10',
          eligibleBaseMinor: 10000,
          decisionAt: new Date('2026-01-01T00:00:00.000Z'),
          customerId: 'cust-1',
          orderId: 'ord-1',
        },
        tx,
      ),
    ).rejects.toMatchObject({
      code: PROMOTION_ERROR_CODES.PROMOTION_STACKING_UNSUPPORTED,
    });
  });

  it('fails closed when code is unknown', async () => {
    repo.findByNormalizedCode.mockResolvedValue(null);
    await expect(
      service.evaluateForPreview({
        code: 'MISSING',
        eligibleBaseMinor: 1000,
        decisionAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: PROMOTION_ERROR_CODES.PROMOTION_NOT_FOUND,
    });
  });
});
