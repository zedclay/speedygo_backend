import {
  assertE2eRedisFlushTarget,
  assertSafeE2eRedisUrl,
  bullmqIsolatedRedisConnection,
  buildE2eRedisFlushArgv,
  E2E_REDIS_DEFAULT_URL,
  isolatedRedisProbesEnabled,
  redactRedisUrl,
  resolveE2eRedisUrl,
} from './e2e-redis-safety';

describe('E2E Redis safety (isolation)', () => {
  it('default URL is SpeedyGo host port 6381 / DB15', () => {
    expect(E2E_REDIS_DEFAULT_URL).toBe('redis://127.0.0.1:6381/15');
    const parsed = assertSafeE2eRedisUrl(E2E_REDIS_DEFAULT_URL);
    expect(parsed.port).toBe(6381);
    expect(parsed.db).toBe(15);
  });

  it('resolves default when E2E_REDIS_URL is unset', () => {
    expect(resolveE2eRedisUrl({})).toBe(E2E_REDIS_DEFAULT_URL);
  });

  it('does not inherit REDIS_URL or TEST_REDIS_URL pointing at :6379', () => {
    const resolved = resolveE2eRedisUrl({
      REDIS_URL: 'redis://localhost:6379/15',
      TEST_REDIS_URL: 'redis://localhost:6379/15',
    });
    expect(resolved).toBe(E2E_REDIS_DEFAULT_URL);
    expect(assertSafeE2eRedisUrl(resolved).port).toBe(6381);
  });

  it('refuses shared host port 6379', () => {
    expect(() => assertSafeE2eRedisUrl('redis://127.0.0.1:6379/15')).toThrow(
      /must not use host port 6379/,
    );
  });

  it('refuses non-DB15 targets', () => {
    expect(() => assertSafeE2eRedisUrl('redis://127.0.0.1:6381/0')).toThrow(
      /must use DB 15/,
    );
  });

  it('refuses wrong host port even if loopback', () => {
    expect(() => assertSafeE2eRedisUrl('redis://127.0.0.1:6380/15')).toThrow(
      /must use host port 6381/,
    );
  });

  it('accepts explicit safe E2E_REDIS_URL override', () => {
    expect(
      resolveE2eRedisUrl({ E2E_REDIS_URL: 'redis://localhost:6381/15' }),
    ).toBe('redis://localhost:6381/15');
  });

  it('redacts passwords from logged URLs', () => {
    expect(redactRedisUrl('redis://user:secret@127.0.0.1:6381/15')).toContain(
      '***',
    );
    expect(
      redactRedisUrl('redis://user:secret@127.0.0.1:6381/15'),
    ).not.toContain('secret');
  });

  it('FLUSHDB argv is hard-locked to 6381 / DB15 after isolation assert', () => {
    const target = assertSafeE2eRedisUrl('redis://127.0.0.1:6381/15');
    expect(buildE2eRedisFlushArgv(target)).toEqual([
      'redis-cli',
      '-h',
      '127.0.0.1',
      '-p',
      '6381',
      '-n',
      '15',
      'FLUSHDB',
    ]);
  });

  it('isolated Redis probes stay off unless RUN_ISOLATED_REDIS_PROBES=1', () => {
    expect(isolatedRedisProbesEnabled({})).toBe(false);
    expect(
      isolatedRedisProbesEnabled({
        E2E_REDIS_URL: 'redis://127.0.0.1:6381/15',
      }),
    ).toBe(false);
    expect(
      isolatedRedisProbesEnabled({ RUN_ISOLATED_REDIS_PROBES: '1' }),
    ).toBe(true);
  });

  it('BullMQ isolated connection is 6381 / DB15 and refuses :6379', () => {
    expect(bullmqIsolatedRedisConnection({})).toMatchObject({
      host: '127.0.0.1',
      port: 6381,
      db: 15,
      maxRetriesPerRequest: null,
    });
    expect(() =>
      bullmqIsolatedRedisConnection({
        E2E_REDIS_URL: 'redis://127.0.0.1:6379/15',
      }),
    ).toThrow(/6379/);
  });

  it('refuses FLUSHDB against shared or wrong DB targets', () => {
    expect(() =>
      assertE2eRedisFlushTarget({
        hostname: '127.0.0.1',
        port: 6379,
        db: 15,
      }),
    ).toThrow(/6379/);
    expect(() =>
      assertE2eRedisFlushTarget({
        hostname: '127.0.0.1',
        port: 6381,
        db: 0,
      }),
    ).toThrow(/DB 15/);
    expect(() =>
      buildE2eRedisFlushArgv({
        hostname: '127.0.0.1',
        port: 6381,
        db: 0,
      }),
    ).toThrow();
  });
});
