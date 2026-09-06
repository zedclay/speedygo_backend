import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../cache/redis.service';
import {
  storageUploadReferenceForeign,
  storageUploadReferenceInvalid,
} from '../domain/storage.errors';

export type PendingUploadRecord = {
  uploadId: string;
  accountId: string;
  ownerType: 'DRIVER' | 'MERCHANT';
  ownerId: string;
  purpose: string;
  /** Pending namespace object key only. */
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

const UPLOAD_PREFIX = 'sg-upload:v1:';

/**
 * Short-lived pending upload tokens only.
 * Bound documents never use Redis.
 */
@Injectable()
export class DocumentObjectRegistry {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private prefix(): string {
    return this.config.get<string>('storage.redisKeyPrefix', 'storage:');
  }

  private pendingTtlSeconds(): number {
    return this.config.get<number>('storage.pendingUploadTtlSeconds', 3600);
  }

  toUploadReference(uploadId: string): string {
    return `${UPLOAD_PREFIX}${uploadId}`;
  }

  parseUploadReference(raw: string): string {
    if (typeof raw !== 'string' || !raw.startsWith(UPLOAD_PREFIX)) {
      throw storageUploadReferenceInvalid();
    }
    const id = raw.slice(UPLOAD_PREFIX.length).trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) && !/^[0-9a-f]{32}$/i.test(id)) {
      throw storageUploadReferenceInvalid();
    }
    return id;
  }

  async savePending(record: PendingUploadRecord): Promise<void> {
    const key = `${this.prefix()}pending:${record.uploadId}`;
    await this.redis
      .getClient()
      .set(key, JSON.stringify(record), 'EX', this.pendingTtlSeconds());
  }

  async takePending(input: {
    uploadReference: string;
    accountId: string;
    ownerType: 'DRIVER' | 'MERCHANT';
    ownerId: string;
    purpose: string;
  }): Promise<PendingUploadRecord> {
    const uploadId = this.parseUploadReference(input.uploadReference);
    const key = `${this.prefix()}pending:${uploadId}`;
    const client = this.redis.getClient();
    const raw = await client.get(key);
    if (!raw) {
      throw storageUploadReferenceForeign();
    }
    const record = JSON.parse(raw) as PendingUploadRecord;
    if (
      record.accountId !== input.accountId ||
      record.ownerType !== input.ownerType ||
      record.ownerId !== input.ownerId ||
      record.purpose !== input.purpose
    ) {
      throw storageUploadReferenceForeign();
    }
    await client.del(key);
    return record;
  }
}
