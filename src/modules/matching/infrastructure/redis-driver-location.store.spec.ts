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

  it('skips older authoritative writes and removes stale GEO members', async () => {
    const evalFn = jest.fn().mockResolvedValue(0);
    const hgetall = jest.fn().mockResolvedValue({
      latitude: '36.75',
      longitude: '3.05',
      recordedAt: '2026-09-02T00:00:10.000Z',
    });
    const zrange = jest.fn().mockResolvedValue(['drv-old']);
    const zrem = jest.fn().mockResolvedValue(1);
    const store = new RedisDriverLocationStore(
      {
        getClient: () => ({ eval: evalFn, hgetall, zrange, zrem }),
      } as unknown as RedisService,
      {
        get: (key: string, fallback: number | string) => {
          if (key === 'matching.redisKeyPrefix') {
            return 'matching:test:';
          }
          if (key === 'tracking.locationTtlMs') {
            return 600_000;
          }
          return fallback;
        },
      } as unknown as ConfigService,
    );
    const skipped = await store.upsertIfNewer(
      'drv-1',
      36.75,
      3.05,
      '2026-09-02T00:00:01.000Z',
    );
    expect(skipped.applied).toBe(false);
    expect(evalFn).toHaveBeenCalled();
    expect(evalFn.mock.calls[0]).toContain('600000');
    const removed = await store.removeStaleGeoMembers(45_000, 20);
    expect(removed).toBe(1);
    expect(zrem).toHaveBeenCalledWith('matching:test:geo', 'drv-old');
  });
});
