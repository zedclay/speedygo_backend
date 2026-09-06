import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PENDING_LIST_PREFIX } from '../domain/durable-locator';
import {
  storageConfigInvalid,
  storageUnavailable,
} from '../domain/storage.errors';
import type { ObjectStoragePort } from '../domain/storage.ports';

/**
 * Private local object adapter for development and E2E.
 * Root must be configured explicitly and must not be a public/static path.
 */
@Injectable()
export class LocalObjectStorage implements ObjectStoragePort {
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('storage.localRoot', '');
    if (!configured || configured.trim() === '') {
      throw storageConfigInvalid(
        'STORAGE_LOCAL_ROOT is required when storage driver is local',
      );
    }
    this.root = path.resolve(configured.trim());
  }

  getRoot(): string {
    return this.root;
  }

  private resolveKey(key: string): string {
    if (
      !key ||
      key.includes('..') ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.includes('\0')
    ) {
      throw storageUnavailable('Invalid object key');
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) {
      throw storageUnavailable('Object key escapes storage root');
    }
    return full;
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const full = this.resolveKey(input.key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs
      .writeFile(full, input.body, { flag: 'wx' })
      .catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await fs.writeFile(full, input.body);
          return;
        }
        throw storageUnavailable('Failed to store object');
      });
    await fs.writeFile(
      `${full}.meta`,
      JSON.stringify({
        contentType: input.contentType,
        size: input.body.length,
      }),
      'utf8',
    );
  }

  async getObject(
    key: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const full = this.resolveKey(key);
    try {
      const body = await fs.readFile(full);
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await fs.readFile(`${full}.meta`, 'utf8')) as {
          contentType?: string;
        };
        if (meta.contentType) {
          contentType = meta.contentType;
        }
      } catch {
        // meta optional
      }
      return { body, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw storageUnavailable('Failed to read object');
    }
  }

  async deleteObject(key: string): Promise<void> {
    const full = this.resolveKey(key);
    await fs.unlink(full).catch(() => undefined);
    await fs.unlink(`${full}.meta`).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    const full = this.resolveKey(key);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }

  async listExpiredPendingObjects(input: {
    olderThanMs: number;
    limit: number;
  }): Promise<{ keys: string[] }> {
    const limit = Math.min(Math.max(1, input.limit), 200);
    const pendingDir = this.resolveKey(PENDING_LIST_PREFIX.replace(/\/$/, ''));
    let entries: string[];
    try {
      entries = await fs.readdir(pendingDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { keys: [] };
      }
      throw storageUnavailable('Failed to list pending objects');
    }
    const cutoff = Date.now() - input.olderThanMs;
    const keys: string[] = [];
    for (const name of entries) {
      if (keys.length >= limit) {
        break;
      }
      if (name.endsWith('.meta') || name.startsWith('.')) {
        continue;
      }
      const full = path.join(pendingDir, name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) {
          continue;
        }
        if (stat.mtimeMs <= cutoff) {
          keys.push(`${PENDING_LIST_PREFIX}${name}`);
        }
      } catch {
        // skip unreadable entries
      }
    }
    return { keys };
  }
}

/** Unguessable object id fragment (not a client path). */
export function newObjectId(): string {
  return randomUUID().replace(/-/g, '');
}
