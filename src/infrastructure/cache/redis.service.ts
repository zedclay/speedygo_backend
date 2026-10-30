import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  ProbeTimeoutError,
  READINESS_PROBE_TIMEOUT_MS,
  shareUntilSettled,
  withProbeTimeout,
  type InFlightSlot,
} from '../health/probe-timeout';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  private readonly sharedPing: InFlightSlot<string> = { current: null };

  onModuleInit(): void {
    const url = this.config.get<string>('redisUrl', 'redis://localhost:6379');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis error: ${error.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  /** Read-only PING. Does not FLUSH, SET, or enqueue. */
  async ping(timeoutMs = READINESS_PROBE_TIMEOUT_MS): Promise<'up' | 'down' | 'timeout'> {
    try {
      if (!this.client) {
        return 'down';
      }
      const result = await withProbeTimeout(
        shareUntilSettled(this.sharedPing, () => this.client.ping()),
        timeoutMs,
        'redis',
      );
      return result === 'PONG' ? 'up' : 'down';
    } catch (error) {
      if (error instanceof ProbeTimeoutError) {
        return 'timeout';
      }
      return 'down';
    }
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
