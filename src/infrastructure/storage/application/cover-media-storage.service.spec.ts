import { ConfigService } from '@nestjs/config';
import { syntheticCoverPng } from '../../../../test/helpers/synthetic-cover-png';
import {
  COVER_PURPOSE,
  LOGO_MAX_BYTES,
  LOGO_PURPOSE,
} from '../domain/cover-media.policy';
import type {
  MalwareScannerPort,
  ObjectStoragePort,
} from '../domain/storage.ports';
import { CoverMediaStorageService } from './cover-media-storage.service';
import { DocumentObjectRegistry } from './document-object.registry';

describe('CoverMediaStorageService', () => {
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

  function service(): CoverMediaStorageService {
    return new CoverMediaStorageService(
      objects,
      { scan: jest.fn().mockResolvedValue({ status: 'CLEAN' }) } as unknown as MalwareScannerPort,
      registry as unknown as DocumentObjectRegistry,
      { get: jest.fn((_key: string, fallback?: unknown) => fallback) } as unknown as ConfigService,
    );
  }

  it('stores pending cover tokens with actor, merchant, branch and purpose', async () => {
    const owner = {
      accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      merchantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    };
    const result = await service().uploadPending(owner, {
      body: syntheticCoverPng(400, 400),
      declaredMime: 'image/png',
    });
    expect(result.purpose).toBe(COVER_PURPOSE);
    expect(registry.savePending).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: owner.accountId,
        ownerType: 'MERCHANT',
        ownerId: owner.merchantId,
        purpose: COVER_PURPOSE,
        branchId: owner.branchId,
      }),
    );
    expect(objects.putObject.mock.calls[0][0].key.startsWith('pending/')).toBe(
      true,
    );
  });

  it('rechecks branch ownership at promote and writes only covers/', async () => {
    const owner = {
      accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      merchantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    };
    registry.takePending.mockResolvedValue({
      objectKey: 'pending/abc.png',
      accountId: owner.accountId,
      ownerType: 'MERCHANT',
      ownerId: owner.merchantId,
      purpose: COVER_PURPOSE,
      branchId: owner.branchId,
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
        purpose: COVER_PURPOSE,
        branchId: owner.branchId,
      }),
    );
    expect(promoted.objectId).toMatch(/^[0-9a-f]{32}$/);
    const coverPuts = objects.putObject.mock.calls.filter((call) =>
      call[0].key.startsWith('covers/'),
    );
    expect(coverPuts).toHaveLength(1);
    expect(coverPuts[0][0].key.startsWith('permanent/')).toBe(false);
  });

  describe('logo kind', () => {
    const owner = {
      accountId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      merchantId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      branchId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    };

    it('stores pending logo tokens under the logo purpose only', async () => {
      const result = await service().uploadPendingLogo(owner, {
        body: syntheticCoverPng(128, 128),
        declaredMime: 'image/png',
      });
      expect(result.purpose).toBe(LOGO_PURPOSE);
      expect(registry.savePending).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: LOGO_PURPOSE, branchId: owner.branchId }),
      );
      expect(registry.savePending).not.toHaveBeenCalledWith(
        expect.objectContaining({ purpose: COVER_PURPOSE }),
      );
    });

    it('accepts small logos that the cover policy would reject', async () => {
      await expect(
        service().uploadPending(owner, { body: syntheticCoverPng(200, 200) }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNSUPPORTED_TYPE' });
      await expect(
        service().uploadPendingLogo(owner, { body: syntheticCoverPng(200, 200) }),
      ).resolves.toMatchObject({ widthPx: 200, heightPx: 200 });
    });

    it('rejects logos outside 128–2048 px, over 1 MiB, or with non-image bytes', async () => {
      await expect(
        service().uploadPendingLogo(owner, { body: syntheticCoverPng(127, 300) }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNSUPPORTED_TYPE' });
      await expect(
        service().uploadPendingLogo(owner, { body: syntheticCoverPng(2049, 300) }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNSUPPORTED_TYPE' });
      const oversized = Buffer.concat([
        syntheticCoverPng(256, 256),
        Buffer.alloc(LOGO_MAX_BYTES),
      ]);
      await expect(
        service().uploadPendingLogo(owner, { body: oversized }),
      ).rejects.toMatchObject({ code: 'STORAGE_FILE_TOO_LARGE' });
      await expect(
        service().uploadPendingLogo(owner, { body: Buffer.from('GIF89a....') }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNSUPPORTED_TYPE' });
      await expect(
        service().uploadPendingLogo(owner, {
          body: syntheticCoverPng(256, 256),
          declaredMime: 'image/jpeg',
        }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNSUPPORTED_TYPE' });
      expect(objects.putObject).not.toHaveBeenCalled();
    });

    it('promotes into logos/ with a fresh object id on every bind', async () => {
      registry.takePending.mockResolvedValue({ objectKey: 'pending/a.png' });
      stored.set('pending/a.png', {
        body: syntheticCoverPng(256, 256),
        contentType: 'image/png',
      });
      const first = await service().promotePendingLogo({
        uploadReference: 'sg-upload:v1:11111111-1111-7111-8111-111111111111',
        ...owner,
      });
      registry.takePending.mockResolvedValue({ objectKey: 'pending/b.png' });
      stored.set('pending/b.png', {
        body: syntheticCoverPng(256, 256),
        contentType: 'image/png',
      });
      const second = await service().promotePendingLogo({
        uploadReference: 'sg-upload:v1:22222222-2222-7222-8222-222222222222',
        ...owner,
      });
      expect(registry.takePending).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: LOGO_PURPOSE }),
      );
      expect(first.objectId).not.toBe(second.objectId);
      expect(stored.has(`logos/${first.objectId}`)).toBe(true);
      expect(stored.has(`logos/${second.objectId}`)).toBe(true);
      expect([...stored.keys()].some((k) => k.startsWith('covers/'))).toBe(false);
      expect(stored.has('pending/a.png')).toBe(false);
    });

    it('deletes only well-formed logo ids inside logos/', async () => {
      stored.set('logos/33333333333333333333333333333333', {
        body: Buffer.from('x'),
        contentType: 'image/png',
      });
      stored.set('covers/33333333333333333333333333333333', {
        body: Buffer.from('x'),
        contentType: 'image/png',
      });
      await service().deleteLogo('../covers/33333333333333333333333333333333');
      await service().deleteLogo('33333333333333333333333333333333');
      expect(stored.has('logos/33333333333333333333333333333333')).toBe(false);
      expect(stored.has('covers/33333333333333333333333333333333')).toBe(true);
    });
  });
});
