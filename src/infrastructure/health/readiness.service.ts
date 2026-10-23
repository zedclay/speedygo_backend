import { Injectable } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';
import { PrismaService } from '../database/database.module';
import { APP_NAME } from '../../common/constants/api.constants';

export type ProbeStatus = 'up' | 'down' | 'timeout';

export type ReadinessResponse = {
  status: 'ok' | 'unavailable';
  service: string;
  checks: {
    postgres: ProbeStatus;
    redis: ProbeStatus;
  };
};

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getReadiness(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.all([
      this.prisma.ping(),
      this.redis.ping(),
    ]);
    const ready = postgres === 'up' && redis === 'up';
    return {
      status: ready ? 'ok' : 'unavailable',
      service: APP_NAME,
      checks: { postgres, redis },
    };
  }
}
