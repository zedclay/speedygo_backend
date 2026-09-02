import { assertMatchingConfig } from './matching-config.validation';

const valid = {
  locationMaxAgeMs: 45_000,
  pickupRadiusMeters: 5000,
  candidateLimit: 20,
  offerTimeoutMs: 30_000,
  retryDelayMs: 15_000,
  recoveryIntervalMs: 15_000,
  recoveryBatchSize: 50,
};

describe('assertMatchingConfig', () => {
  it('accepts frozen Driver Matching v1.0 defaults', () => {
    expect(() => assertMatchingConfig(valid)).not.toThrow();
  });

  it('rejects zero, negative, and non-integer matching values', () => {
    expect(() => assertMatchingConfig({ ...valid, offerTimeoutMs: 0 })).toThrow(
      /MATCHING_OFFER_TIMEOUT_MS/,
    );
    expect(() =>
      assertMatchingConfig({ ...valid, pickupRadiusMeters: -1 }),
    ).toThrow(/MATCHING_PICKUP_RADIUS_METERS/);
    expect(() =>
      assertMatchingConfig({ ...valid, locationMaxAgeMs: 1.5 }),
    ).toThrow(/MATCHING_LOCATION_MAX_AGE_MS/);
    expect(() => assertMatchingConfig({ ...valid, candidateLimit: 0 })).toThrow(
      /MATCHING_CANDIDATE_LIMIT/,
    );
    expect(() =>
      assertMatchingConfig({ ...valid, retryDelayMs: -15_000 }),
    ).toThrow(/MATCHING_RETRY_DELAY_MS/);
  });
});
