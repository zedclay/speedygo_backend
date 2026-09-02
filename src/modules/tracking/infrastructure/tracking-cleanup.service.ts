import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisDriverLocationStore } from '../../matching/infrastructure/redis-driver-location.store';

@Injectable()
export class TrackingCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly locations: RedisDriverLocationStore,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = this.config.get<number>(
      'tracking.staleCleanupIntervalMs',
      30_000,
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
    const maxAgeMs = this.config.get<number>(
      'tracking.staleCleanupMaxAgeMs',
      300_000,
    );
    const batch = this.config.get<number>(
      'tracking.staleCleanupBatchSize',
      100,
    );
    try {
      const removed = await this.locations.removeStaleGeoMembers(
        maxAgeMs,
        batch,
      );
      if (removed > 0) {
        this.logger.debug(`Removed ${removed} stale GEO members`);
      }
      return removed;
    } catch (error) {
      this.logger.warn(
        `Stale GEO cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
