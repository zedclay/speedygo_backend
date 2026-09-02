process.env.NODE_ENV = 'test';
process.env.OTP_TRANSPORT = 'test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length >= 32
    ? process.env.JWT_ACCESS_SECRET
    : 'test-jwt-access-secret-at-least-32-chars';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET && process.env.OTP_HMAC_SECRET.length >= 32
    ? process.env.OTP_HMAC_SECRET
    : 'test-otp-hmac-secret-at-least-32-ch';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://speedygo:speedygo@localhost:5432/speedygo_test?schema=public';
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.AUTH_REDIS_PREFIX = 'auth:test:';
process.env.MATCHING_REDIS_PREFIX = 'matching:test:';
process.env.MATCHING_BULL_PREFIX = 'bull:matching:test';
process.env.MATCHING_LOCATION_MAX_AGE_MS = '45000';
process.env.MATCHING_PICKUP_RADIUS_METERS = '5000';
process.env.MATCHING_CANDIDATE_LIMIT = '20';
process.env.MATCHING_OFFER_TIMEOUT_MS = '30000';
process.env.MATCHING_RETRY_DELAY_MS = '15000';
process.env.MATCHING_RECOVERY_INTERVAL_MS = '15000';
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
process.env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR = '1000';
process.env.OTP_MAX_REQUESTS_PER_HOUR = '20';
