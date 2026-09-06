import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORAGE_ERROR_CODES } from '../domain/storage.errors';
import { LocalObjectStorage, newObjectId } from './local-object.storage';

describe('LocalObjectStorage', () => {
  let root: string;
  let storage: LocalObjectStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'speedygo-unit-storage-'));
    storage = new LocalObjectStorage({
      get: (key: string) => (key === 'storage.localRoot' ? root : undefined),
    } as ConfigService);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('requires an explicit local root', () => {
    try {
      new LocalObjectStorage({
        get: () => '',
      } as ConfigService);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_CONFIG_INVALID,
      );
    }
  });

  it('stores and reads within the configured root', async () => {
    const key = `private/driver/${newObjectId()}.png`;
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await storage.putObject({ key, body, contentType: 'image/png' });
    const read = await storage.getObject(key);
    expect(read?.body.equals(body)).toBe(true);
    expect(read?.contentType).toBe('image/png');
    expect(await storage.exists(key)).toBe(true);
  });

  it('rejects path traversal and absolute keys', async () => {
    await expect(
      storage.putObject({
        key: '../escape.bin',
        body: Buffer.from('x'),
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
    await expect(
      storage.putObject({
        key: '/tmp/absolute.bin',
        body: Buffer.from('x'),
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
  });

  it('rejects relative traversal keys that escape the root', async () => {
    await expect(storage.exists('../outside.txt')).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
    const outside = join(root, '..', `outside-${newObjectId()}.txt`);
    writeFileSync(outside, 'secret');
    await expect(
      storage.getObject(`../${outside.split('/').pop()!}`),
    ).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
  });

  it('generates unique object ids', () => {
    expect(newObjectId()).not.toBe(newObjectId());
  });
});
