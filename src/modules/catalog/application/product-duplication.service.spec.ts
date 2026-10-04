import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import {
  defaultDuplicateName,
  duplicateRequestKey,
  ProductDuplicationService,
} from './product-duplication.service';

const accountId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const sourceId = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const copyId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const requestId = '11111111-1111-4111-8111-111111111111';
const sourceObject = '0123456789abcdef0123456789abcdef';
const copiedObject = 'fedcba9876543210fedcba9876543210';

describe('ProductDuplicationService', () => {
  const access = { requireCapability: jest.fn() };
  const merchants = { findOwnedBranch: jest.fn() };
  const catalog = { findProduct: jest.fn() };
  const duplication = {
    findByRequestKey: jest.fn(),
    duplicate: jest.fn(),
    countCopiedConfiguration: jest.fn(),
  };
  const images = { findByProduct: jest.fn() };
  const imageStorage = { copyImage: jest.fn() };
  const productImages = { deleteUnreferencedImage: jest.fn() };
  const catalogService = { getProduct: jest.fn() };
  let service: ProductDuplicationService;

  const source = {
    id: sourceId,
    merchantBranchId: branchId,
    categoryId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
    name: 'Couscous Royal',
    description: 'Semoule',
    priceMinor: 150000,
    available: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireCapability.mockResolvedValue(undefined);
    catalog.findProduct.mockResolvedValue(source);
    merchants.findOwnedBranch.mockResolvedValue({ id: branchId });
    duplication.findByRequestKey.mockResolvedValue(null);
    images.findByProduct.mockResolvedValue(null);
    productImages.deleteUnreferencedImage.mockResolvedValue(undefined);
    catalogService.getProduct.mockImplementation(
      (_a: string, _m: string, id: string) =>
        Promise.resolve({ id, available: false }),
    );
    service = new ProductDuplicationService(
      access as never,
      merchants as never,
      catalog as never,
      duplication as never,
      images as never,
      imageStorage as never,
      productImages as never,
      catalogService as never,
    );
  });

  it('requires PRODUCT_MANAGE; STAFF is rejected before any read or write', async () => {
    const forbidden = new Error('MERCHANT_ROLE_FORBIDDEN');
    access.requireCapability.mockRejectedValue(forbidden);
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toBe(forbidden);
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    expect(duplication.duplicate).not.toHaveBeenCalled();
    expect(imageStorage.copyImage).not.toHaveBeenCalled();
  });

  it('rejects a product of a foreign branch as CATALOG_PRODUCT_NOT_FOUND', async () => {
    merchants.findOwnedBranch.mockResolvedValue(null);
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toMatchObject({ code: 'CATALOG_PRODUCT_NOT_FOUND' });
    catalog.findProduct.mockResolvedValue(null);
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toMatchObject({ code: 'CATALOG_PRODUCT_NOT_FOUND' });
    expect(duplication.duplicate).not.toHaveBeenCalled();
  });

  it('creates one copy with the default French name and reports what was copied', async () => {
    duplication.duplicate.mockResolvedValue({
      status: 'created',
      productId: copyId,
      optionGroupCount: 2,
      optionCount: 5,
      imageCopied: false,
    });
    const result = await service.duplicate(accountId, merchantId, sourceId, {
      requestId,
    });
    expect(duplication.duplicate).toHaveBeenCalledWith({
      sourceProductId: sourceId,
      requestKey: duplicateRequestKey(sourceId, requestId),
      name: 'Copie de Couscous Royal',
      image: null,
    });
    expect(result).toEqual({
      product: { id: copyId, available: false },
      replayed: false,
      copied: { optionGroupCount: 2, optionCount: 5, imageCopied: false },
    });
  });

  it('uses the submitted name when provided', async () => {
    duplication.duplicate.mockResolvedValue({
      status: 'created',
      productId: copyId,
      optionGroupCount: 0,
      optionCount: 0,
      imageCopied: false,
    });
    await service.duplicate(accountId, merchantId, sourceId, {
      requestId,
      name: '  Couscous Royal (grand)  ',
    });
    expect(duplication.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Couscous Royal (grand)' }),
    );
  });

  it('copies image bytes to a new object and passes only the new object id', async () => {
    images.findByProduct.mockResolvedValue({ objectId: sourceObject });
    const copied = {
      objectId: copiedObject,
      contentType: 'image/png',
      byteSize: 10,
      widthPx: 400,
      heightPx: 400,
    };
    imageStorage.copyImage.mockResolvedValue(copied);
    duplication.duplicate.mockResolvedValue({
      status: 'created',
      productId: copyId,
      optionGroupCount: 0,
      optionCount: 0,
      imageCopied: true,
    });
    await service.duplicate(accountId, merchantId, sourceId, { requestId });
    expect(imageStorage.copyImage).toHaveBeenCalledWith(sourceObject);
    expect(duplication.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({ image: copied }),
    );
    expect(productImages.deleteUnreferencedImage).not.toHaveBeenCalled();
  });

  it('deletes only the copied object (never the source) when the transaction fails', async () => {
    images.findByProduct.mockResolvedValue({ objectId: sourceObject });
    imageStorage.copyImage.mockResolvedValue({
      objectId: copiedObject,
      contentType: 'image/png',
      byteSize: 10,
      widthPx: 400,
      heightPx: 400,
    });
    duplication.duplicate.mockRejectedValue(new Error('child insert failed'));
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toThrow('child insert failed');
    expect(productImages.deleteUnreferencedImage).toHaveBeenCalledWith(
      copiedObject,
    );
    expect(productImages.deleteUnreferencedImage).not.toHaveBeenCalledWith(
      sourceObject,
    );
  });

  it('creates the copy without an image when the source object is missing', async () => {
    images.findByProduct.mockResolvedValue({ objectId: sourceObject });
    imageStorage.copyImage.mockResolvedValue(null);
    duplication.duplicate.mockResolvedValue({
      status: 'created',
      productId: copyId,
      optionGroupCount: 0,
      optionCount: 0,
      imageCopied: false,
    });
    const result = await service.duplicate(accountId, merchantId, sourceId, {
      requestId,
    });
    expect(duplication.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({ image: null }),
    );
    expect(result.copied.imageCopied).toBe(false);
  });

  it('replays an existing copy for the same requestId without creating another', async () => {
    duplication.findByRequestKey.mockResolvedValue({
      id: copyId,
      merchantBranchId: branchId,
    });
    duplication.countCopiedConfiguration.mockResolvedValue({
      optionGroupCount: 2,
      optionCount: 5,
      imageCopied: true,
    });
    const result = await service.duplicate(accountId, merchantId, sourceId, {
      requestId,
    });
    expect(result.replayed).toBe(true);
    expect(result.product).toEqual({ id: copyId, available: false });
    expect(duplication.duplicate).not.toHaveBeenCalled();
    expect(imageStorage.copyImage).not.toHaveBeenCalled();
  });

  it('a concurrent identical request that loses the unique race replays the winner and discards its image copy', async () => {
    images.findByProduct.mockResolvedValue({ objectId: sourceObject });
    imageStorage.copyImage.mockResolvedValue({
      objectId: copiedObject,
      contentType: 'image/png',
      byteSize: 10,
      widthPx: 400,
      heightPx: 400,
    });
    duplication.findByRequestKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: copyId, merchantBranchId: branchId });
    duplication.duplicate.mockResolvedValue({ status: 'duplicate_key' });
    duplication.countCopiedConfiguration.mockResolvedValue({
      optionGroupCount: 0,
      optionCount: 0,
      imageCopied: true,
    });
    const result = await service.duplicate(accountId, merchantId, sourceId, {
      requestId,
    });
    expect(result.replayed).toBe(true);
    expect(productImages.deleteUnreferencedImage).toHaveBeenCalledWith(
      copiedObject,
    );
  });

  it('refuses to replay a key bound to another branch', async () => {
    duplication.findByRequestKey.mockResolvedValue({
      id: copyId,
      merchantBranchId: '99999999-9999-7999-8999-999999999999',
    });
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toMatchObject({
      code: 'CATALOG_DUPLICATE_REQUEST_CONFLICT',
      httpStatus: 409,
    });
  });

  it('source deleted mid-flight → 404 and copied image discarded', async () => {
    images.findByProduct.mockResolvedValue({ objectId: sourceObject });
    imageStorage.copyImage.mockResolvedValue({
      objectId: copiedObject,
      contentType: 'image/png',
      byteSize: 10,
      widthPx: 400,
      heightPx: 400,
    });
    duplication.duplicate.mockResolvedValue({ status: 'source_missing' });
    await expect(
      service.duplicate(accountId, merchantId, sourceId, { requestId }),
    ).rejects.toMatchObject({ code: 'CATALOG_PRODUCT_NOT_FOUND' });
    expect(productImages.deleteUnreferencedImage).toHaveBeenCalledWith(
      copiedObject,
    );
  });

  it('default name and request key are deterministic', () => {
    expect(defaultDuplicateName('Pizza')).toBe('Copie de Pizza');
    const long = 'é'.repeat(300);
    expect(Array.from(defaultDuplicateName(long))).toHaveLength(255);
    expect(duplicateRequestKey(sourceId, requestId)).toBe(
      duplicateRequestKey(sourceId, requestId.toUpperCase()),
    );
    expect(duplicateRequestKey(sourceId, requestId)).toMatch(/^[0-9a-f]{64}$/);
    expect(duplicateRequestKey(copyId, requestId)).not.toBe(
      duplicateRequestKey(sourceId, requestId),
    );
  });
});
