import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSafeE2eDatabaseUrl,
  redactDatabaseUrl,
  resolveE2eDatabaseUrl,
} from '../src/config/e2e-database-safety';
import {
  assertSafeE2eRedisUrl,
  redactRedisUrl,
  resolveE2eRedisUrl,
} from '../src/config/e2e-redis-safety';

process.env.NODE_ENV = 'test';
process.env.OTP_TRANSPORT = 'test';
// Explicit E2E browser origin allowlist (exact match only — not open CORS).
process.env.CORS_ALLOWED_ORIGINS =
  process.env.CORS_ALLOWED_ORIGINS?.trim() || 'http://127.0.0.1:5173';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length >= 32
    ? process.env.JWT_ACCESS_SECRET
    : 'test-jwt-access-secret-at-least-32-chars';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET && process.env.OTP_HMAC_SECRET.length >= 32
    ? process.env.OTP_HMAC_SECRET
    : 'test-otp-hmac-secret-at-least-32-ch';

// Dedicated SpeedyGo E2E Postgres (Compose host port 5433, speedygo_test). Fail closed —
// never inherit DATABASE_URL / TEST_DATABASE_URL on :5432 (Homebrew) or speedygo_dev.
const e2eDatabaseUrl = resolveE2eDatabaseUrl(process.env);
process.env.DATABASE_URL = e2eDatabaseUrl;
assertSafeE2eDatabaseUrl(e2eDatabaseUrl);
void redactDatabaseUrl(e2eDatabaseUrl);

// Dedicated SpeedyGo E2E Redis (Compose host port 6381, DB15). Fail closed —
// never inherit shared REDIS_URL / TEST_REDIS_URL on :6379.
const e2eRedisUrl = resolveE2eRedisUrl(process.env);
process.env.REDIS_URL = e2eRedisUrl;
const e2eRedis = assertSafeE2eRedisUrl(e2eRedisUrl);

process.env.AUTH_REDIS_PREFIX = 'auth:test:';
process.env.MATCHING_REDIS_PREFIX = 'matching:test:';
process.env.MATCHING_BULL_PREFIX = 'bull:matching:test';
process.env.MATCHING_LOCATION_MAX_AGE_MS = '45000';
process.env.MATCHING_PICKUP_RADIUS_METERS = '5000';
process.env.MATCHING_CANDIDATE_LIMIT = '20';
process.env.MATCHING_OFFER_TIMEOUT_MS = '30000';
process.env.MATCHING_RETRY_DELAY_MS = '15000';
// Disable background recovery/cleanup loops during e2e — they race cleanup and matching.
process.env.MATCHING_RECOVERY_INTERVAL_MS = '86400000';
process.env.NOTIFICATIONS_RECOVERY_INTERVAL_MS = '86400000';
process.env.NOTIFICATIONS_RECOVERY_BATCH_SIZE = '50';
process.env.NOTIFICATIONS_RECOVERY_LOOKBACK_MS = '86400000';
process.env.DRIVER_DELIVERY_PICKUP_RADIUS_METERS = '300';
process.env.DRIVER_DELIVERY_DROPOFF_RADIUS_METERS = '300';
process.env.TRACKING_LOCATION_TTL_MS = '600000';
process.env.TRACKING_STALE_CLEANUP_INTERVAL_MS = '30000';
process.env.TRACKING_STALE_CLEANUP_MAX_AGE_MS = '300000';
process.env.TRACKING_STALE_CLEANUP_BATCH_SIZE = '100';
process.env.TRACKING_MIN_UPDATE_INTERVAL_MS = '1000';
process.env.TRACKING_AUTH_REVALIDATION_INTERVAL_MS = '200';
process.env.TRACKING_REDIS_PREFIX = 'tracking:test:';
process.env.TRACKING_SOCKET_ADAPTER_PREFIX = 'socket.io:tracking:test';
process.env.AUTH_DEFAULT_COUNTRY = 'DZ';
process.env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR = '10000';
process.env.OTP_MAX_REQUESTS_PER_HOUR = '1000';
process.env.PAYMENT_PROVIDER = 'test';
process.env.PAYMENT_TEST_WEBHOOK_SECRET =
  process.env.PAYMENT_TEST_WEBHOOK_SECRET &&
  process.env.PAYMENT_TEST_WEBHOOK_SECRET.length >= 16
    ? process.env.PAYMENT_TEST_WEBHOOK_SECRET
    : 'test-payment-webhook-secret';

// Private object storage for verification document E2E (isolated temp root; never repo paths).
const e2eStorageRoot = mkdtempSync(join(tmpdir(), 'speedygo-e2e-storage-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_ROOT = e2eStorageRoot;
process.env.STORAGE_REDIS_PREFIX = 'storage:test:';
process.env.STORAGE_MALWARE_SCAN_REQUIRED = 'true';
process.env.STORAGE_MALWARE_SCANNER_DRIVER = 'clamav';
process.env.STORAGE_CLAMAV_HOST = '127.0.0.1';
process.env.STORAGE_CLAMAV_PORT = '3311';
process.env.STORAGE_CLAMAV_CONNECT_TIMEOUT_MS = '5000';
process.env.STORAGE_CLAMAV_SCAN_TIMEOUT_MS = '60000';
process.env.STORAGE_UPLOADS_ENABLED = 'true';
process.env.STORAGE_PENDING_UPLOAD_TTL_SECONDS = '3600';
process.env.STORAGE_PENDING_CLEANUP_INTERVAL_MS = '86400000';

// Deterministic e2e isolation: flush SpeedyGo E2E Redis DB15 only (never :6379).
try {
  execSync(
    `redis-cli -h ${e2eRedis.hostname === 'localhost' ? '127.0.0.1' : e2eRedis.hostname} -p ${e2eRedis.port} -n ${e2eRedis.db} FLUSHDB`,
    { stdio: 'ignore' },
  );
} catch {
  // Redis may be unavailable in unit-only environments; e2e fails clearly later.
  void redactRedisUrl(e2eRedisUrl);
}
