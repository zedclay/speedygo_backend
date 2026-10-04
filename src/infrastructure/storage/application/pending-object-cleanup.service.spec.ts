import { ConfigService } from '@nestjs/config';
import type { ObjectStoragePort } from '../domain/storage.ports';
import { PendingObjectCleanupService } from './pending-object-cleanup.service';

describe('PendingObjectCleanupService', () => {
  it('never deletes covers/, product-images/, or permanent/ keys even if a listing leaks them', async () => {
    const deleted: string[] = [];
    const objects = {
      listExpiredPendingObjects: jest.fn().mockResolvedValue({
        keys: [
          'pending/old.png',
          'covers/abc',
          'product-images/abc',
          'permanent/doc',
        ],
      }),
      deleteObject: jest.fn((key: string) => {
        deleted.push(key);
        return Promise.resolve();
      }),
    };
    const config = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };
    const service = new PendingObjectCleanupService(
      objects as unknown as ObjectStoragePort,
      config as unknown as ConfigService,
    );
    const removed = await service.sweep();
    expect(removed).toBe(1);
    expect(deleted).toEqual(['pending/old.png']);
  });
});
