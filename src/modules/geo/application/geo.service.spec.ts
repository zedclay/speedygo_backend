import { GEO_ERROR_CODES } from '../domain/geo.errors';
import { GeoService } from './geo.service';

describe('GeoService geocoding', () => {
  it('fails closed for autocomplete when GOOGLE_MAPS_API_KEY is empty', async () => {
    const service = new GeoService(
      {} as never,
      { get: () => '' } as never,
    );
    await expect(
      service.autocompletePlaces({ q: 'Sidi Bel Abbès centre' }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
    });
  });

  it('fails closed for reverse geocode when GOOGLE_MAPS_API_KEY is empty', async () => {
    const service = new GeoService(
      {} as never,
      { get: () => '' } as never,
    );
    await expect(
      service.reverseGeocode({ latitude: 35.1939, longitude: -0.6417 }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
    });
  });

  it('fails closed for place details when GOOGLE_MAPS_API_KEY is empty', async () => {
    const service = new GeoService(
      {} as never,
      { get: () => '' } as never,
    );
    await expect(
      service.resolvePlace({ placeId: 'ChIJ-sba-centre' }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
    });
  });

  it('returns empty suggestions without a provider call when q is short', async () => {
    const service = new GeoService(
      {} as never,
      { get: () => 'present-but-unused' } as never,
    );
    await expect(service.autocompletePlaces({ q: 'S' })).resolves.toEqual({
      configured: true,
      suggestions: [],
    });
  });

  it('rejects the 0,0 substitute for reverse geocode', async () => {
    const service = new GeoService(
      {} as never,
      { get: () => 'present-but-unused' } as never,
    );
    await expect(
      service.reverseGeocode({ latitude: 0, longitude: 0 }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_LOCATION_INVALID,
    });
  });
});
