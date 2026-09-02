export type MatchingRuntimeConfig = {
  locationMaxAgeMs: number;
  pickupRadiusMeters: number;
  candidateLimit: number;
  offerTimeoutMs: number;
  retryDelayMs: number;
  recoveryIntervalMs: number;
  recoveryBatchSize: number;
};

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function assertMatchingConfig(config: MatchingRuntimeConfig): void {
  requirePositiveInteger(
    'MATCHING_LOCATION_MAX_AGE_MS',
    config.locationMaxAgeMs,
  );
  requirePositiveInteger(
    'MATCHING_PICKUP_RADIUS_METERS',
    config.pickupRadiusMeters,
  );
  requirePositiveInteger('MATCHING_CANDIDATE_LIMIT', config.candidateLimit);
  requirePositiveInteger('MATCHING_OFFER_TIMEOUT_MS', config.offerTimeoutMs);
  requirePositiveInteger('MATCHING_RETRY_DELAY_MS', config.retryDelayMs);
  requirePositiveInteger(
    'MATCHING_RECOVERY_INTERVAL_MS',
    config.recoveryIntervalMs,
  );
  requirePositiveInteger(
    'MATCHING_RECOVERY_BATCH_SIZE',
    config.recoveryBatchSize,
  );
}
