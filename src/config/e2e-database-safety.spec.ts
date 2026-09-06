import {
  assertSafeE2eDatabaseUrl,
  E2E_DATABASE_DEFAULT_URL,
  redactDatabaseUrl,
  resolveE2eDatabaseUrl,
} from './e2e-database-safety';

describe('E2E database safety (isolation)', () => {
  it('default URL is SpeedyGo host port 5433 / speedygo_test', () => {
    const parsed = assertSafeE2eDatabaseUrl(E2E_DATABASE_DEFAULT_URL);
    expect(parsed.port).toBe(5433);
    expect(parsed.database).toBe('speedygo_test');
    expect(parsed.hostname).toBe('127.0.0.1');
  });

  it('resolves default when E2E_DATABASE_URL is unset', () => {
    expect(resolveE2eDatabaseUrl({})).toBe(E2E_DATABASE_DEFAULT_URL);
  });

  it('does not inherit DATABASE_URL or TEST_DATABASE_URL on :5432', () => {
    const resolved = resolveE2eDatabaseUrl({
      DATABASE_URL:
        'postgresql://speedygo:speedygo@localhost:5432/speedygo_test?schema=public',
      TEST_DATABASE_URL:
        'postgresql://speedygo:speedygo@localhost:5432/speedygo_test?schema=public',
    });
    expect(resolved).toBe(E2E_DATABASE_DEFAULT_URL);
    expect(assertSafeE2eDatabaseUrl(resolved).port).toBe(5433);
  });

  it('refuses shared host port 5432', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        'postgresql://speedygo:speedygo@127.0.0.1:5432/speedygo_test?schema=public',
      ),
    ).toThrow(/must not use host port 5432/);
  });

  it('refuses speedygo_dev', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev?schema=public',
      ),
    ).toThrow(/must not use speedygo_dev/);
  });

  it('refuses postgres maintenance database', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/postgres',
      ),
    ).toThrow(/postgres maintenance database/);
  });

  it('refuses wrong database name', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/other_db',
      ),
    ).toThrow(/must be speedygo_test/);
  });

  it('refuses remote hosts', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        'postgresql://speedygo:speedygo@db.example.com:5433/speedygo_test',
      ),
    ).toThrow(/must target loopback/);
  });

  it('refuses malformed URLs', () => {
    expect(() => assertSafeE2eDatabaseUrl('not-a-url')).toThrow(
      /not a valid URL/,
    );
  });

  it('accepts explicit safe E2E_DATABASE_URL override', () => {
    const url =
      'postgresql://speedygo:speedygo@localhost:5433/speedygo_test?schema=public';
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: url })).toBe(url);
  });

  it('redacts passwords from logged URLs', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://user:secret@127.0.0.1:5433/speedygo_test',
    );
    expect(redacted).toContain('***');
    expect(redacted).not.toContain('secret');
  });
});
