import { ConfigService } from '@nestjs/config';
import { STORAGE_ERROR_CODES } from '../domain/storage.errors';
import { RedisService } from '../../cache/redis.service';
import { DocumentObjectRegistry } from './document-object.registry';

describe('DocumentObjectRegistry.takePending', () => {
  const redis = {
    get: jest.fn(),
    del: jest.fn(),
    set: jest.fn(),
  };
  const registry = new DocumentObjectRegistry(
    {
      getClient: () => redis,
    } as unknown as RedisService,
    {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a cover pending token when binding as a product image', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        uploadId: '11111111-1111-7111-8111-111111111111',
        accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        ownerType: 'MERCHANT',
        ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
        purpose: 'MERCHANT_BRANCH_COVER',
        branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        objectKey: 'pending/cover.png',
        contentType: 'image/png',
        sizeBytes: 12,
        createdAt: new Date().toISOString(),
      }),
    );
    await expect(
      registry.takePending({
        uploadReference: 'sg-upload:v1:11111111-1111-7111-8111-111111111111',
        accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        ownerType: 'MERCHANT',
        ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
        purpose: 'PRODUCT_IMAGE',
        branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        productId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UPLOAD_REFERENCE_FOREIGN,
    });
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('rejects a product-image token on a different product', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        uploadId: '11111111-1111-7111-8111-111111111111',
        accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        ownerType: 'MERCHANT',
        ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
        purpose: 'PRODUCT_IMAGE',
        branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        productId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
        objectKey: 'pending/product.png',
        contentType: 'image/png',
        sizeBytes: 12,
        createdAt: new Date().toISOString(),
      }),
    );
    await expect(
      registry.takePending({
        uploadReference: 'sg-upload:v1:11111111-1111-7111-8111-111111111111',
        accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        ownerType: 'MERCHANT',
        ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
        purpose: 'PRODUCT_IMAGE',
        branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        productId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
      }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UPLOAD_REFERENCE_FOREIGN,
    });
  });
});
