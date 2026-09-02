import { assertTrackingConfig } from './tracking-config.validation';

const valid = {
  locationTtlMs: 600_000,
  staleCleanupIntervalMs: 30_000,
  staleCleanupMaxAgeMs: 300_000,
  staleCleanupBatchSize: 100,
  minUpdateIntervalMs: 1000,
  authRevalidationIntervalMs: 15_000,
};

describe('assertTrackingConfig', () => {
  it('accepts Realtime Tracking v1.0 defaults', () => {
    expect(() => assertTrackingConfig(valid)).not.toThrow();
  });

  it('rejects invalid tracking values', () => {
    expect(() => assertTrackingConfig({ ...valid, locationTtlMs: 0 })).toThrow(
      /TRACKING_LOCATION_TTL_MS/,
    );
    expect(() =>
      assertTrackingConfig({ ...valid, minUpdateIntervalMs: -1 }),
    ).toThrow(/TRACKING_MIN_UPDATE_INTERVAL_MS/);
    expect(() =>
      assertTrackingConfig({ ...valid, authRevalidationIntervalMs: 0 }),
    ).toThrow(/TRACKING_AUTH_REVALIDATION_INTERVAL_MS/);
    expect(() =>
      assertTrackingConfig({ ...valid, locationTtlMs: 1000 }),
    ).toThrow(/at least MATCHING_LOCATION_MAX_AGE_MS/);
    expect(() =>
      assertTrackingConfig({ ...valid, staleCleanupMaxAgeMs: 45_000 }),
    ).toThrow(/greater than MATCHING_LOCATION_MAX_AGE_MS/);
    expect(() =>
      assertTrackingConfig({ ...valid, locationTtlMs: 300_000 }),
    ).toThrow(/greater than TRACKING_STALE_CLEANUP_MAX_AGE_MS/);
  });
});
