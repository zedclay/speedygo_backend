/**
 * Fail-closed guards for SpeedyGo E2E Redis isolation.
 * E2E must use dedicated host Redis (Compose host port 6381) and DB15 only.
 */

export const E2E_REDIS_DEFAULT_URL = 'redis://127.0.0.1:6381/15';
export const E2E_REDIS_REQUIRED_HOST_PORT = 6381;
export const E2E_REDIS_REQUIRED_DB = 15;

export type ParsedE2eRedisUrl = {
  hostname: string;
  port: number;
  db: number;
};

export function parseRedisUrl(url: string): ParsedE2eRedisUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`E2E Redis URL is not a valid URL: ${redactRedisUrl(url)}`);
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(
      `E2E Redis URL must use redis: or rediss: (got ${parsed.protocol})`,
    );
  }
  const hostname = parsed.hostname;
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'rediss:'
      ? 6380
      : 6379;
  const path = parsed.pathname.replace(/^\//, '');
  const db = path.length === 0 ? 0 : Number.parseInt(path, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`E2E Redis URL has invalid port: ${redactRedisUrl(url)}`);
  }
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(
      `E2E Redis URL has invalid DB index: ${redactRedisUrl(url)}`,
    );
  }
  return { hostname, port, db };
}

/** Never log passwords from redis URLs. */
export function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) {
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '[unparseable-redis-url]';
  }
}

/**
 * Accept only SpeedyGo E2E Redis: loopback host, port 6381, database 15.
 * Refuses shared/default Redis on 6379 and any non-DB15 target.
 */
export function assertSafeE2eRedisUrl(url: string): ParsedE2eRedisUrl {
  const parsed = parseRedisUrl(url);
  const loopback =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1';
  if (!loopback) {
    throw new Error(
      `E2E Redis must target loopback (got host ${parsed.hostname})`,
    );
  }
  if (parsed.port === 6379) {
    throw new Error(
      'E2E Redis must not use host port 6379 (shared/other-project Redis). Use SpeedyGo Compose host port 6381.',
    );
  }
  if (parsed.port !== E2E_REDIS_REQUIRED_HOST_PORT) {
    throw new Error(
      `E2E Redis must use host port ${E2E_REDIS_REQUIRED_HOST_PORT} (got ${parsed.port})`,
    );
  }
  if (parsed.db !== E2E_REDIS_REQUIRED_DB) {
    throw new Error(
      `E2E Redis must use DB ${E2E_REDIS_REQUIRED_DB} (got DB ${parsed.db})`,
    );
  }
  return parsed;
}

export function resolveE2eRedisUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Explicit E2E override only — never silently inherit REDIS_URL / TEST_REDIS_URL
  // (those often point at shared localhost:6379).
  const candidate = env.E2E_REDIS_URL?.trim() || E2E_REDIS_DEFAULT_URL;
  assertSafeE2eRedisUrl(candidate);
  return candidate;
}
