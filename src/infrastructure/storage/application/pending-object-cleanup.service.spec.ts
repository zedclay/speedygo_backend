import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalObjectStorage,
  newObjectId,
} from '../adapters/local-object.storage';
import { PendingObjectCleanupService } from './pending-object-cleanup.service';

describe('PendingObjectCleanupService', () => {
  let root: string;
  let storage: LocalObjectStorage;
  let cleanup: PendingObjectCleanupService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'speedygo-orphan-'));
    storage = new LocalObjectStorage({
      get: (key: string) => (key === 'storage.localRoot' ? root : undefined),
    } as ConfigService);
    cleanup = new PendingObjectCleanupService(storage, {
      get: (key: string, fallback?: unknown) => {
        if (key === 'storage.pendingUploadTtlSeconds') {
          return 1;
        }
        if (key === 'storage.pendingCleanupBatchSize') {
          return 50;
        }
        if (key === 'storage.pendingCleanupIntervalMs') {
          return 86_400_000;
        }
        return fallback;
      },
    } as ConfigService);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('deletes expired pending and retains fresh pending and permanent', async () => {
    const oldKey = `pending/old-${newObjectId()}.png`;
    const freshKey = `pending/fresh-${newObjectId()}.png`;
    const permanentKey = `permanent/${newObjectId()}`;
    await storage.putObject({
      key: oldKey,
      body: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
    });
    await storage.putObject({
      key: freshKey,
      body: Buffer.from([4, 5, 6]),
      contentType: 'image/png',
    });
    await storage.putObject({
      key: permanentKey,
      body: Buffer.from([7, 8, 9]),
      contentType: 'image/png',
    });

    const ancient = new Date(Date.now() - 60_000);
    utimesSync(join(root, oldKey), ancient, ancient);

    const removed = await cleanup.sweep();
    expect(removed).toBe(1);
    expect(await storage.exists(oldKey)).toBe(false);
    expect(await storage.exists(freshKey)).toBe(true);
    expect(await storage.exists(permanentKey)).toBe(true);
  });

  it('deletes expired pending even when Redis metadata is absent', async () => {
    const key = `pending/orphan-${newObjectId()}.bin`;
    await storage.putObject({
      key,
      body: Buffer.from('orphan'),
      contentType: 'application/octet-stream',
    });
    const ancient = new Date(Date.now() - 120_000);
    utimesSync(join(root, key), ancient, ancient);
    expect(await cleanup.sweep()).toBe(1);
    expect(await storage.exists(key)).toBe(false);
  });

  it('honors batch limit', async () => {
    const limited = new PendingObjectCleanupService(storage, {
      get: (key: string, fallback?: unknown) => {
        if (key === 'storage.pendingUploadTtlSeconds') {
          return 1;
        }
        if (key === 'storage.pendingCleanupBatchSize') {
          return 2;
        }
        return fallback;
      },
    } as ConfigService);
    const ancient = new Date(Date.now() - 120_000);
    for (let i = 0; i < 5; i += 1) {
      const key = `pending/batch-${i}-${newObjectId()}.bin`;
      await storage.putObject({
        key,
        body: Buffer.from([i]),
        contentType: 'application/octet-stream',
      });
      utimesSync(join(root, key), ancient, ancient);
    }
    expect(await limited.sweep()).toBe(2);
    const remaining = (await readdir(join(root, 'pending'))).filter(
      (n) => !n.endsWith('.meta'),
    );
    expect(remaining.length).toBe(3);
  });
});
