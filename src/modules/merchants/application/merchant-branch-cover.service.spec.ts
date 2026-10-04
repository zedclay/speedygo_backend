import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { MerchantBranchCoverService } from './merchant-branch-cover.service';

const accountId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const branchA = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const branchB = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const previousObject = '11111111111111111111111111111111';
const nextObject = '22222222222222222222222222222222';

describe('MerchantBranchCoverService', () => {
  const access = { requireCapability: jest.fn() };
  const merchants = { findOwnedBranch: jest.fn() };
  const covers = {
    upsert: jest.fn(),
    deleteByBranch: jest.fn(),
    findByBranch: jest.fn(),
    findByObjectId: jest.fn(),
  };
  const media = {
    uploadPending: jest.fn(),
    promotePending: jest.fn(),
    deleteCover: jest.fn(),
    readCover: jest.fn(),
  };

  let service: MerchantBranchCoverService;

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireCapability.mockResolvedValue(undefined);
    merchants.findOwnedBranch.mockImplementation(
      (_merchant: string, branchId: string) =>
        Promise.resolve(
          branchId === branchA || branchId === branchB
            ? { id: branchId }
            : null,
        ),
    );
    media.deleteCover.mockResolvedValue(undefined);
    service = new MerchantBranchCoverService(
      access as never,
      merchants as never,
      covers as never,
      media as never,
    );
  });

  it('binds pending uploads to actor, merchant, purpose and branch', async () => {
    await service.uploadContent(accountId, merchantId, branchA, {
      body: Buffer.alloc(1),
    });
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    expect(media.uploadPending).toHaveBeenCalledWith(
      { accountId, merchantId, branchId: branchA },
      expect.any(Object),
    );

    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    covers.upsert.mockResolvedValue({
      previous: null,
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    await service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref');
    expect(media.promotePending).toHaveBeenCalledWith({
      uploadReference: 'sg-upload:v1:ref',
      accountId,
      merchantId,
      branchId: branchA,
    });
  });

  it('does not delete the previous cover when the database write fails', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    covers.upsert.mockRejectedValue(new Error('db write failed'));
    covers.findByObjectId.mockResolvedValue(null);
    await expect(
      service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref'),
    ).rejects.toThrow('db write failed');
    expect(media.deleteCover).toHaveBeenCalledWith(nextObject);
    expect(media.deleteCover).not.toHaveBeenCalledWith(previousObject);
  });

  it('does not delete a cover object that is still referenced', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    covers.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    covers.findByObjectId.mockResolvedValue({ objectId: previousObject });
    await service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref');
    expect(media.deleteCover).not.toHaveBeenCalled();
  });

  it('deletes only an unreferenced previous cover after a successful replace', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    covers.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    covers.findByObjectId.mockResolvedValue(null);
    await service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref');
    expect(media.deleteCover).toHaveBeenCalledWith(previousObject);
    expect(media.deleteCover).not.toHaveBeenCalledWith(nextObject);
  });
});
