const MATCHING_LOCATION_MAX_AGE_MS = 45_000;

export type TrackingRuntimeConfig = {
  locationTtlMs: number;
  staleCleanupIntervalMs: number;
  staleCleanupMaxAgeMs: number;
  staleCleanupBatchSize: number;
  minUpdateIntervalMs: number;
  authRevalidationIntervalMs: number;
  locationMaxAgeMs?: number;
};

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function assertTrackingConfig(config: TrackingRuntimeConfig): void {
  const freshness = config.locationMaxAgeMs ?? MATCHING_LOCATION_MAX_AGE_MS;
  requirePositiveInteger('TRACKING_LOCATION_TTL_MS', config.locationTtlMs);
  requirePositiveInteger(
    'TRACKING_STALE_CLEANUP_INTERVAL_MS',
    config.staleCleanupIntervalMs,
  );
  requirePositiveInteger(
    'TRACKING_STALE_CLEANUP_MAX_AGE_MS',
    config.staleCleanupMaxAgeMs,
  );
  requirePositiveInteger(
    'TRACKING_STALE_CLEANUP_BATCH_SIZE',
    config.staleCleanupBatchSize,
  );
  requirePositiveInteger(
    'TRACKING_MIN_UPDATE_INTERVAL_MS',
    config.minUpdateIntervalMs,
  );
  requirePositiveInteger(
    'TRACKING_AUTH_REVALIDATION_INTERVAL_MS',
    config.authRevalidationIntervalMs,
  );
  if (freshness <= 0) {
    throw new Error('MATCHING_LOCATION_MAX_AGE_MS must be a positive integer');
  }
  if (config.locationTtlMs < freshness) {
    throw new Error(
      'TRACKING_LOCATION_TTL_MS must be at least MATCHING_LOCATION_MAX_AGE_MS',
    );
  }
  if (config.staleCleanupMaxAgeMs <= freshness) {
    throw new Error(
      'TRACKING_STALE_CLEANUP_MAX_AGE_MS must be greater than MATCHING_LOCATION_MAX_AGE_MS',
    );
  }
  if (config.locationTtlMs <= config.staleCleanupMaxAgeMs) {
    throw new Error(
      'TRACKING_LOCATION_TTL_MS must be greater than TRACKING_STALE_CLEANUP_MAX_AGE_MS',
    );
  }
}
