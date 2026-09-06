import { ConfigService } from '@nestjs/config';
import { STORAGE_ERROR_CODES } from '../domain/storage.errors';
import type {
  MalwareScannerPort,
  ObjectStoragePort,
} from '../domain/storage.ports';
import { DocumentObjectRegistry } from './document-object.registry';
import { SecureDocumentStorageService } from './secure-document-storage.service';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('SecureDocumentStorageService (durable)', () => {
  let objects: jest.Mocked<ObjectStoragePort>;
  let scanner: jest.Mocked<MalwareScannerPort>;
  let registry: {
    toUploadReference: jest.Mock;
    savePending: jest.Mock;
    takePending: jest.Mock;
  };
  let config: { get: jest.Mock };
  let service: SecureDocumentStorageService;
  const stored = new Map<string, { body: Buffer; contentType: string }>();

  beforeEach(() => {
    stored.clear();
    objects = {
      putObject: jest.fn(
        (input: { key: string; body: Buffer; contentType: string }) => {
          stored.set(input.key, {
            body: input.body,
            contentType: input.contentType,
          });
          return Promise.resolve();
        },
      ),
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
    scanner = {
      scan: jest.fn().mockResolvedValue({ status: 'CLEAN' }),
    };
    registry = {
      toUploadReference: jest.fn((id: string) => `sg-upload:v1:${id}`),
      savePending: jest.fn().mockResolvedValue(undefined),
      takePending: jest.fn(),
    };
    config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'storage.malwareScanRequired') {
          return false;
        }
        return fallback;
      }),
    };
    service = new SecureDocumentStorageService(
      objects,
      scanner,
      registry as unknown as DocumentObjectRegistry,
      config as unknown as ConfigService,
    );
  });

  const owner = {
    accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    ownerType: 'DRIVER' as const,
    ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    purpose: 'IDENTITY',
  };

  it('stores pending under pending/ namespace', async () => {
    const result = await service.uploadPending(owner, {
      body: PNG_1X1,
      declaredMime: 'image/png',
    });
    expect(result.uploadReference.startsWith('sg-upload:v1:')).toBe(true);
    const putKey = objects.putObject.mock.calls[0][0].key;
    expect(putKey.startsWith('pending/')).toBe(true);
    expect(putKey.startsWith('permanent/')).toBe(false);
  });

  it('promotes to permanent durable locator without Redis bind', async () => {
    registry.takePending.mockResolvedValue({
      uploadId: 'u1',
      accountId: owner.accountId,
      ownerType: 'DRIVER',
      ownerId: owner.ownerId,
      purpose: 'IDENTITY',
      objectKey: 'pending/abc.png',
      contentType: 'image/png',
      sizeBytes: PNG_1X1.length,
      createdAt: new Date().toISOString(),
    });
    stored.set('pending/abc.png', {
      body: PNG_1X1,
      contentType: 'image/png',
    });
    const promoted = await service.promotePendingToPermanent({
      uploadReference: 'sg-upload:v1:11111111-1111-7111-8111-111111111111',
      accountId: owner.accountId,
      ownerType: 'DRIVER',
      ownerId: owner.ownerId,
      purpose: 'IDENTITY',
    });
    expect(promoted.durableLocator.startsWith('sg-object:v1:')).toBe(true);
    expect(promoted.permanentKey.startsWith('permanent/')).toBe(true);
    const read = await service.readDurableContent({
      durableLocator: promoted.durableLocator,
      documentId: 'doc-1',
    });
    expect(read.body.equals(PNG_1X1)).toBe(true);
  });

  it('treats legacy metadata references as unavailable without Redis', async () => {
    await expect(
      service.readDurableContent({
        durableLocator: 'sg-object:driver-document:legacy',
        documentId: 'doc-1',
      }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_LEGACY_REFERENCE_UNAVAILABLE,
    });
  });

  it('fail-closes infected scan before store', async () => {
    scanner.scan.mockResolvedValue({
      status: 'INFECTED',
      reason: 'Eicar-Test-Signature',
    });
    await expect(
      service.uploadPending(owner, { body: PNG_1X1 }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_SCAN_REJECTED,
    });
    expect(objects.putObject.mock.calls.length).toBe(0);
  });

  it('fail-closes when scan required and unavailable', async () => {
    scanner.scan.mockResolvedValue({
      status: 'UNAVAILABLE',
      reason: 'down',
    });
    config.get.mockImplementation((key: string) =>
      key === 'storage.malwareScanRequired' ? true : undefined,
    );
    await expect(
      service.uploadPending(owner, { body: PNG_1X1 }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_SCAN_UNAVAILABLE,
    });
  });
});
