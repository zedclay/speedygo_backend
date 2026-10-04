import { ConfigService } from '@nestjs/config';
import { syntheticCoverPng } from '../../../../test/helpers/synthetic-cover-png';
import { PRODUCT_IMAGE_PURPOSE } from '../domain/product-image.policy';
import type {
  MalwareScannerPort,
  ObjectStoragePort,
} from '../domain/storage.ports';
import { DocumentObjectRegistry } from './document-object.registry';
import { ProductImageStorageService } from './product-image-storage.service';

describe('ProductImageStorageService', () => {
  const stored = new Map<string, { body: Buffer; contentType: string }>();
  let objects: jest.Mocked<ObjectStoragePort>;
  let registry: {
    toUploadReference: jest.Mock;
    savePending: jest.Mock;
    takePending: jest.Mock;
  };

  beforeEach(() => {
    stored.clear();
    objects = {
      putObject: jest.fn((input) => {
        stored.set(input.key, {
          body: input.body,
          contentType: input.contentType,
        });
        return Promise.resolve();
      }),
      getObject: jest.fn((key: string) =>
        Promise.resolve(stored.get(key) ?? null),
      ),
      deleteObject: jest.fn((key: string) => {
        stored.delete(key);
        return Promise.resolve();
      }),
      exists: jest.fn((key: string) => Promise.resolve(stored.has(key))),
      listExpiredPendingObjects: jest.fn().mockResolvedValue({ keys: [] }),
    };
    registry = {
      toUploadReference: jest.fn((id: string) => `sg-upload:v1:${id}`),
      savePending: jest.fn().mockResolvedValue(undefined),
      takePending: jest.fn(),
    };
  });

  function service(): ProductImageStorageService {
    return new ProductImageStorageService(
      objects,
      {
        scan: jest.fn().mockResolvedValue({ status: 'CLEAN' }),
      } as unknown as MalwareScannerPort,
      registry as unknown as DocumentObjectRegistry,
      {
        get: jest.fn((_key: string, fallback?: unknown) => fallback),
      } as unknown as ConfigService,
    );
  }

  it('stores pending product-image tokens with actor, merchant, branch, product and purpose', async () => {
    const owner = {
      accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      merchantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      productId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    };
    const result = await service().uploadPending(owner, {
      body: syntheticCoverPng(400, 400),
      declaredMime: 'image/png',
    });
    expect(result.purpose).toBe(PRODUCT_IMAGE_PURPOSE);
    expect(registry.savePending).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: owner.accountId,
        ownerType: 'MERCHANT',
        ownerId: owner.merchantId,
        purpose: PRODUCT_IMAGE_PURPOSE,
        branchId: owner.branchId,
        productId: owner.productId,
      }),
    );
    expect(objects.putObject.mock.calls[0][0].key.startsWith('pending/')).toBe(
      true,
    );
  });

  it('rechecks product ownership at promote and writes only product-images/', async () => {
    const owner = {
      accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      merchantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      productId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    };
    registry.takePending.mockResolvedValue({
      objectKey: 'pending/abc.png',
      accountId: owner.accountId,
      ownerType: 'MERCHANT',
      ownerId: owner.merchantId,
      purpose: PRODUCT_IMAGE_PURPOSE,
      branchId: owner.branchId,
      productId: owner.productId,
    });
    stored.set('pending/abc.png', {
      body: syntheticCoverPng(400, 400),
      contentType: 'image/png',
    });
    const promoted = await service().promotePending({
      uploadReference: 'sg-upload:v1:11111111-1111-7111-8111-111111111111',
      ...owner,
    });
    expect(registry.takePending).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: owner.accountId,
        ownerId: owner.merchantId,
        purpose: PRODUCT_IMAGE_PURPOSE,
        branchId: owner.branchId,
        productId: owner.productId,
      }),
    );
    expect(promoted.objectId).toMatch(/^[0-9a-f]{32}$/);
    const imagePuts = objects.putObject.mock.calls.filter((call) =>
      call[0].key.startsWith('product-images/'),
    );
    expect(imagePuts).toHaveLength(1);
    expect(imagePuts[0][0].key.startsWith('permanent/')).toBe(false);
    expect(imagePuts[0][0].key.startsWith('covers/')).toBe(false);
  });

  it('copyImage writes identical bytes under a fresh object id and leaves the source intact', async () => {
    const sourceId = '0123456789abcdef0123456789abcdef';
    const body = syntheticCoverPng(400, 400);
    stored.set(`product-images/${sourceId}`, { body, contentType: 'image/png' });
    const copy = await service().copyImage(sourceId);
    expect(copy).not.toBeNull();
    expect(copy!.objectId).toMatch(/^[0-9a-f]{32}$/);
    expect(copy!.objectId).not.toBe(sourceId);
    expect(stored.get(`product-images/${copy!.objectId}`)?.body.equals(body)).toBe(true);
    expect(stored.get(`product-images/${sourceId}`)?.body.equals(body)).toBe(true);
    expect(copy).toMatchObject({ contentType: 'image/png', widthPx: 400, heightPx: 400 });

    await service().deleteImage(copy!.objectId);
    expect(stored.has(`product-images/${sourceId}`)).toBe(true);
  });

  it('copyImage returns null for a missing or malformed source object', async () => {
    await expect(
      service().copyImage('0123456789abcdef0123456789abcdef'),
    ).resolves.toBeNull();
    await expect(service().copyImage('../covers/x')).resolves.toBeNull();
    expect(objects.putObject).not.toHaveBeenCalled();
  });
});
