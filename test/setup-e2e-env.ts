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
process.env.AUTH_DEFAULT_COUNTRY = 'DZ';
process.env.OTP_MAX_REQUESTS_PER_IP_PER_HOUR = '1000';
process.env.OTP_MAX_REQUESTS_PER_HOUR = '20';
