import { GEO_ERROR_CODES } from '../domain/geo.errors';
import { GeoService } from './geo.service';

/**
 * Mocked Places/Geocoding HTTP. Does not call Google.
 * Live provider checks live in docs/audits/2026-10-24/GEO_MAPS_SEARCH/LIVE_HTTP.md.
 */
describe('GeoService Places proxy (mocked fetch)', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    calls.length = 0;
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch;
  }

  function serviceWithKey() {
    return new GeoService({} as never, { get: () => 'server-key-fixture' } as never);
  }

  it('posts Autocomplete (New) with DZ region and a session token', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJ-hydra',
                text: { text: 'Hydra, Alger' },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const out = await serviceWithKey().autocompletePlaces({
      q: 'Hydra',
      language: 'fr',
      sessionToken: '11111111-2222-4333-8444-555555555555',
    });

    expect(out).toEqual({
      configured: true,
      suggestions: [{ placeId: 'ChIJ-hydra', text: 'Hydra, Alger' }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://places.googleapis.com/v1/places:autocomplete',
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toContain(
      'suggestions.placePrediction.placeId',
    );
    expect(headers['X-Goog-Api-Key']).toBeDefined();
    const body = JSON.parse(String(calls[0].init?.body)) as {
      includedRegionCodes: string[];
      regionCode: string;
      sessionToken: string;
      languageCode: string;
    };
    expect(body.includedRegionCodes).toEqual(['dz']);
    expect(body.regionCode).toBe('dz');
    expect(body.languageCode).toBe('fr');
    expect(body.sessionToken).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('omits empty sessionToken from Autocomplete (New)', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await serviceWithKey().autocompletePlaces({
      q: 'Hydra',
      sessionToken: '   ',
    });
    const body = JSON.parse(String(calls[0].init?.body)) as {
      sessionToken?: string;
    };
    expect(body.sessionToken).toBeUndefined();
  });

  it('resolves Place Details (New) and forwards the session token', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            id: 'ChIJ-hydra',
            formattedAddress: 'Hydra, Alger, Algérie',
            location: { latitude: 36.748, longitude: 3.039 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const out = await serviceWithKey().resolvePlace({
      placeId: 'places/ChIJ-hydra',
      language: 'ar',
      sessionToken: '11111111-2222-4333-8444-555555555555',
    });
    expect(out.configured).toBe(true);
    expect(out.formattedAddress).toBe('Hydra, Alger, Algérie');
    expect(out.latitude).toBe(36.748);
    expect(out.longitude).toBe(3.039);
    expect(calls[0].url).toContain('sessionToken=11111111-2222-4333-8444-555555555555');
    expect(calls[0].url).toContain('languageCode=ar');
    expect(calls[0].url).toContain('/v1/places/ChIJ-hydra');
  });

  it('rejects Place Details that return 0,0', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            id: 'zero',
            location: { latitude: 0, longitude: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await expect(
      serviceWithKey().resolvePlace({ placeId: 'zero' }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_LOCATION_INVALID,
    });
  });

  it('maps provider HTTP failure without inventing suggestions', async () => {
    mockFetch(
      () =>
        new Response('upstream', {
          status: 403,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );

    await expect(
      serviceWithKey().autocompletePlaces({ q: 'Hydra' }),
    ).rejects.toMatchObject({
      code: GEO_ERROR_CODES.GEO_LOCATION_INVALID,
    });
  });
});
