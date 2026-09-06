import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PENDING_LIST_PREFIX } from '../domain/durable-locator';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '../domain/storage.ports';

/**
 * Deletes expired pending/ objects using ObjectStorage listing (not Redis).
 * Never touches permanent/. Cleanup failure never affects bound documents.
 */
@Injectable()
export class PendingObjectCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PendingObjectCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objects: ObjectStoragePort,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = this.config.get<number>(
      'storage.pendingCleanupIntervalMs',
      60_000,
    );
    this.timer = setInterval(() => {
      void this.sweep();
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<number> {
    const ttlSeconds = this.config.get<number>(
      'storage.pendingUploadTtlSeconds',
      3600,
    );
    const batch = this.config.get<number>(
      'storage.pendingCleanupBatchSize',
      50,
    );
    const olderThanMs = Math.max(1, ttlSeconds) * 1000;
    try {
      const { keys } = await this.objects.listExpiredPendingObjects({
        olderThanMs,
        limit: batch,
      });
      let removed = 0;
      for (const key of keys) {
        if (!key.startsWith(PENDING_LIST_PREFIX) || key.includes('..')) {
          continue;
        }
        if (key.startsWith('permanent/')) {
          continue;
        }
        await this.objects.deleteObject(key);
        removed += 1;
      }
      if (removed > 0) {
        this.logger.debug(`Pending orphan cleanup removed ${removed} objects`);
      }
      return removed;
    } catch {
      this.logger.warn('Pending orphan cleanup failed');
      return 0;
    }
  }
}
