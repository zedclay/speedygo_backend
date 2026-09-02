const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  apiGlobalPrefix: process.env.API_GLOBAL_PREFIX ?? 'api/v1',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    jwtAccessTtlSeconds: int(process.env.JWT_ACCESS_TTL_SECONDS, 900),
    sessionTtlDays: int(process.env.AUTH_SESSION_TTL_DAYS, 30),
    otpHmacSecret: process.env.OTP_HMAC_SECRET ?? '',
    otpTtlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    otpResendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    otpMaxRequestsPerHour: int(process.env.OTP_MAX_REQUESTS_PER_HOUR, 5),
    otpMaxRequestsPerIpPerHour: int(
      process.env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR,
      20,
    ),
    defaultCountry: process.env.AUTH_DEFAULT_COUNTRY ?? 'DZ',
    otpTransport: process.env.OTP_TRANSPORT ?? 'disabled',
    trustProxy: process.env.AUTH_TRUST_PROXY === 'true',
    redisKeyPrefix: process.env.AUTH_REDIS_PREFIX ?? 'auth:',
    sessionCacheTtlSeconds: int(process.env.AUTH_SESSION_CACHE_TTL_SECONDS, 15),
    permissionCacheTtlSeconds: int(
      process.env.AUTH_PERMISSION_CACHE_TTL_SECONDS,
      15,
    ),
  },
  matching: {
    locationMaxAgeMs: int(process.env.MATCHING_LOCATION_MAX_AGE_MS, 45_000),
    pickupRadiusMeters: int(process.env.MATCHING_PICKUP_RADIUS_METERS, 5000),
    candidateLimit: int(process.env.MATCHING_CANDIDATE_LIMIT, 20),
    offerTimeoutMs: int(process.env.MATCHING_OFFER_TIMEOUT_MS, 30_000),
    retryDelayMs: int(process.env.MATCHING_RETRY_DELAY_MS, 15_000),
    recoveryIntervalMs: int(process.env.MATCHING_RECOVERY_INTERVAL_MS, 15_000),
    recoveryBatchSize: int(process.env.MATCHING_RECOVERY_BATCH_SIZE, 50),
    redisKeyPrefix: process.env.MATCHING_REDIS_PREFIX ?? 'matching:',
    bullPrefix: process.env.MATCHING_BULL_PREFIX ?? 'bull:matching',
  },
  driverDelivery: {
    pickupRadiusMeters: int(
      process.env.DRIVER_DELIVERY_PICKUP_RADIUS_METERS,
      300,
    ),
    dropoffRadiusMeters: int(
      process.env.DRIVER_DELIVERY_DROPOFF_RADIUS_METERS,
      300,
    ),
  },
  tracking: {
    locationTtlMs: int(process.env.TRACKING_LOCATION_TTL_MS, 600_000),
    authRevalidationIntervalMs: int(
      process.env.TRACKING_AUTH_REVALIDATION_INTERVAL_MS,
      15_000,
    ),
    staleCleanupIntervalMs: int(
      process.env.TRACKING_STALE_CLEANUP_INTERVAL_MS,
      30_000,
    ),
    staleCleanupMaxAgeMs: int(
      process.env.TRACKING_STALE_CLEANUP_MAX_AGE_MS,
      300_000,
    ),
    staleCleanupBatchSize: int(
      process.env.TRACKING_STALE_CLEANUP_BATCH_SIZE,
      100,
    ),
    minUpdateIntervalMs: int(process.env.TRACKING_MIN_UPDATE_INTERVAL_MS, 1000),
    redisKeyPrefix: process.env.TRACKING_REDIS_PREFIX ?? 'tracking:',
    socketAdapterPrefix:
      process.env.TRACKING_SOCKET_ADAPTER_PREFIX ?? 'socket.io:tracking',
  },
});
