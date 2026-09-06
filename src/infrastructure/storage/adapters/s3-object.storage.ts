import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PENDING_LIST_PREFIX } from '../domain/durable-locator';
import {
  storageConfigInvalid,
  storageUnavailable,
} from '../domain/storage.errors';
import type { ObjectStoragePort } from '../domain/storage.ports';

/**
 * S3-compatible private object adapter (AWS S3, R2, MinIO, etc.).
 * Never returns public URLs. Credentials stay in config only.
 */
@Injectable()
export class S3ObjectStorage implements ObjectStoragePort, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('storage.s3.endpoint', '');
    const region = config.get<string>('storage.s3.region', '');
    const bucket = config.get<string>('storage.s3.bucket', '');
    const accessKeyId = config.get<string>('storage.s3.accessKeyId', '');
    const secretAccessKey = config.get<string>(
      'storage.s3.secretAccessKey',
      '',
    );
    const forcePathStyle = config.get<boolean>(
      'storage.s3.forcePathStyle',
      true,
    );
    if (!bucket || !accessKeyId || !secretAccessKey || !region) {
      throw storageConfigInvalid(
        'S3 storage requires STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY',
      );
    }
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch {
      throw storageUnavailable('Failed to store object');
    }
  }

  async getObject(
    key: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) {
        return null;
      }
      const bytes = await result.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        return null;
      }
      throw storageUnavailable('Failed to read object');
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      // best-effort delete
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
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
    const cutoff = new Date(Date.now() - input.olderThanMs);
    try {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: PENDING_LIST_PREFIX,
          MaxKeys: limit,
        }),
      );
      const keys: string[] = [];
      for (const obj of result.Contents ?? []) {
        if (!obj.Key || !obj.LastModified) {
          continue;
        }
        if (!obj.Key.startsWith(PENDING_LIST_PREFIX)) {
          continue;
        }
        if (obj.Key.includes('..')) {
          continue;
        }
        if (obj.LastModified <= cutoff) {
          keys.push(obj.Key);
        }
        if (keys.length >= limit) {
          break;
        }
      }
      return { keys };
    } catch {
      throw storageUnavailable('Failed to list pending objects');
    }
  }
}
