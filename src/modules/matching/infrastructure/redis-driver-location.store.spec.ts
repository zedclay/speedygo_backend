import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import { RedisDriverLocationStore } from './redis-driver-location.store';

describe('RedisDriverLocationStore', () => {
  it('bounds GEO lookup with COUNT equal to the candidate limit', async () => {
    const georadius = jest.fn().mockResolvedValue([]);
    const store = new RedisDriverLocationStore(
      {
        getClient: () => ({ georadius }),
      } as unknown as RedisService,
      {
        get: (key: string, fallback: number | string) => {
          if (key === 'matching.redisKeyPrefix') {
            return 'matching:test:';
          }
          if (key === 'matching.locationMaxAgeMs') {
            return 45_000;
          }
          return fallback;
        },
      } as unknown as ConfigService,
    );
    await store.searchNear(36.75, 3.05, 5000, 20);
    expect(georadius).toHaveBeenCalledWith(
      'matching:test:geo',
      3.05,
      36.75,
      5000,
      'm',
      'WITHDIST',
      'ASC',
      'COUNT',
      20,
    );
  });
});
