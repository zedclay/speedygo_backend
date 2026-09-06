/**
 * Fail-closed guards for SpeedyGo E2E PostgreSQL isolation.
 * E2E must use dedicated host Postgres (Compose host port 5433) and speedygo_test only.
 */

export const E2E_DATABASE_REQUIRED_HOST_PORT = 5433;
export const E2E_DATABASE_REQUIRED_NAME = 'speedygo_test';

/** Local-only template credentials already used by Compose/E2E foundations (not production). */
export const E2E_DATABASE_DEFAULT_URL =
  'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_test?schema=public';

export type ParsedE2eDatabaseUrl = {
  hostname: string;
  port: number;
  database: string;
};

/** Never log passwords from database URLs. */
export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) {
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '[unparseable-database-url]';
  }
}

export function parseDatabaseUrl(url: string): ParsedE2eDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `E2E database URL is not a valid URL: ${redactDatabaseUrl(url)}`,
    );
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      `E2E database URL must use postgresql: or postgres: (got ${parsed.protocol})`,
    );
  }
  const hostname = parsed.hostname;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split(
    '?',
  )[0];
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `E2E database URL has invalid port: ${redactDatabaseUrl(url)}`,
    );
  }
  if (!database || database.trim().length === 0) {
    throw new Error(
      `E2E database URL is missing a database name: ${redactDatabaseUrl(url)}`,
    );
  }
  return { hostname, port, database };
}

/**
 * Accept only SpeedyGo E2E Postgres: loopback host, port 5433, database speedygo_test.
 * Refuses Homebrew/shared Postgres on 5432 and any non-test database.
 */
export function assertSafeE2eDatabaseUrl(url: string): ParsedE2eDatabaseUrl {
  const parsed = parseDatabaseUrl(url);
  const loopback =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1';
  if (!loopback) {
    throw new Error(
      `E2E database must target loopback (got host ${parsed.hostname})`,
    );
  }
  if (parsed.port === 5432) {
    throw new Error(
      'E2E database must not use host port 5432 (Homebrew/other Postgres). Use SpeedyGo Compose host port 5433.',
    );
  }
  if (parsed.port !== E2E_DATABASE_REQUIRED_HOST_PORT) {
    throw new Error(
      `E2E database must use host port ${E2E_DATABASE_REQUIRED_HOST_PORT} (got ${parsed.port})`,
    );
  }
  if (parsed.database === 'speedygo_dev') {
    throw new Error(
      'E2E database must not use speedygo_dev. Use speedygo_test only.',
    );
  }
  if (parsed.database === 'postgres') {
    throw new Error(
      'E2E database must not use the postgres maintenance database. Use speedygo_test only.',
    );
  }
  if (parsed.database !== E2E_DATABASE_REQUIRED_NAME) {
    throw new Error(
      `E2E database must be ${E2E_DATABASE_REQUIRED_NAME} (got ${parsed.database})`,
    );
  }
  return parsed;
}

export function resolveE2eDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Explicit E2E override only — never silently inherit DATABASE_URL / TEST_DATABASE_URL
  // (those often point at localhost:5432 / Homebrew or speedygo_dev).
  const candidate = env.E2E_DATABASE_URL?.trim() || E2E_DATABASE_DEFAULT_URL;
  assertSafeE2eDatabaseUrl(candidate);
  return candidate;
}
