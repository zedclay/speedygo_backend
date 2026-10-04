import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { MerchantProductImageService } from './merchant-product-image.service';

const accountId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const branchA = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const productA = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const productB = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const previousObject = '11111111111111111111111111111111';
const nextObject = '22222222222222222222222222222222';

describe('MerchantProductImageService', () => {
  const access = { requireCapability: jest.fn() };
  const merchants = { findOwnedBranch: jest.fn() };
  const catalog = { findProduct: jest.fn() };
  const images = {
    upsert: jest.fn(),
    deleteByProduct: jest.fn(),
    findByProduct: jest.fn(),
    findByObjectId: jest.fn(),
  };
  const media = {
    uploadPending: jest.fn(),
    promotePending: jest.fn(),
    deleteImage: jest.fn(),
    readImage: jest.fn(),
  };

  let service: MerchantProductImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireCapability.mockResolvedValue(undefined);
    merchants.findOwnedBranch.mockImplementation(
      (_merchant: string, branchId: string) =>
        Promise.resolve(branchId === branchA ? { id: branchId } : null),
    );
    catalog.findProduct.mockImplementation((productId: string) =>
      Promise.resolve(
        productId === productA || productId === productB
          ? { id: productId, merchantBranchId: branchA }
          : null,
      ),
    );
    media.deleteImage.mockResolvedValue(undefined);
    service = new MerchantProductImageService(
      access as never,
      merchants as never,
      catalog as never,
      images as never,
      media as never,
    );
  });

  it('binds pending uploads to actor, merchant, branch, product and purpose', async () => {
    await service.uploadContent(accountId, merchantId, branchA, productA, {
      body: Buffer.alloc(1),
    });
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    expect(media.uploadPending).toHaveBeenCalledWith(
      { accountId, merchantId, branchId: branchA, productId: productA },
      expect.any(Object),
    );

    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    images.upsert.mockResolvedValue({
      previous: null,
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    await service.bind(
      accountId,
      merchantId,
      branchA,
      productA,
      'sg-upload:v1:ref',
    );
    expect(media.promotePending).toHaveBeenCalledWith({
      uploadReference: 'sg-upload:v1:ref',
      accountId,
      merchantId,
      branchId: branchA,
      productId: productA,
    });
  });

  it('does not delete the previous image when the database write fails', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    images.upsert.mockRejectedValue(new Error('db write failed'));
    images.findByObjectId.mockResolvedValue(null);
    await expect(
      service.bind(
        accountId,
        merchantId,
        branchA,
        productA,
        'sg-upload:v1:ref',
      ),
    ).rejects.toThrow('db write failed');
    expect(media.deleteImage).toHaveBeenCalledWith(nextObject);
    expect(media.deleteImage).not.toHaveBeenCalledWith(previousObject);
  });

  it('does not delete an image object that is still referenced', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    images.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    images.findByObjectId.mockResolvedValue({ objectId: previousObject });
    await service.bind(
      accountId,
      merchantId,
      branchA,
      productA,
      'sg-upload:v1:ref',
    );
    expect(media.deleteImage).not.toHaveBeenCalled();
  });

  it('deletes only an unreferenced previous image after a successful replace', async () => {
    media.promotePending.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
      byteSize: 12,
      widthPx: 400,
      heightPx: 400,
    });
    images.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: {
        objectId: nextObject,
        widthPx: 400,
        heightPx: 400,
        contentType: 'image/png',
      },
    });
    images.findByObjectId.mockResolvedValue(null);
    await service.bind(
      accountId,
      merchantId,
      branchA,
      productA,
      'sg-upload:v1:ref',
    );
    expect(media.deleteImage).toHaveBeenCalledWith(previousObject);
    expect(media.deleteImage).not.toHaveBeenCalledWith(nextObject);
  });
});
