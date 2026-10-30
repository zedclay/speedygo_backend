import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  geoCommuneNotFound,
  geoCommuneWilayaMismatch,
  geoGeocodingNotConfigured,
  geoLocationInvalid,
  geoWilayaNotFound,
} from '../domain/geo.errors';
import {
  toCommuneView,
  toWilayaView,
  type CommuneView,
  type WilayaView,
} from '../domain/geo.types';
import { GeoRepository } from '../infrastructure/geo.repository';

@Injectable()
export class GeoService {
  constructor(
    private readonly geo: GeoRepository,
    private readonly config: ConfigService,
  ) {}

  private googleMapsApiKey(): string {
    return (this.config.get<string>('maps.googleApiKey') ?? '').trim();
  }

  /** Server Places/Geocoding only. Never log or return the key. */
  private async googleFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw geoLocationInvalid('Address search provider request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  async listWilayas(): Promise<{ wilayas: WilayaView[] }> {
    const rows = await this.geo.listWilayas();
    return { wilayas: rows.map(toWilayaView) };
  }

  async listCommunes(
    wilayaCode: string,
    q?: string,
  ): Promise<{ communes: CommuneView[] }> {
    const wilaya = await this.geo.findWilaya(wilayaCode);
    if (!wilaya) {
      throw geoWilayaNotFound();
    }
    const rows = await this.geo.listCommunesByWilaya(wilayaCode, q);
    return { communes: rows.map(toCommuneView) };
  }

  /**
   * Validates that both identifiers are set and the commune belongs to the wilaya.
   * Returns display names for response enrichment.
   */
  async assertValidPair(
    wilayaCode: string | null | undefined,
    communeId: number | null | undefined,
  ): Promise<{ wilayaNameFr: string; communeNameFr: string }> {
    if (
      wilayaCode === null ||
      wilayaCode === undefined ||
      wilayaCode.trim() === '' ||
      communeId === null ||
      communeId === undefined
    ) {
      throw geoLocationInvalid(
        'wilayaCode and communeId are required together',
      );
    }
    if (!/^\d{2}$/.test(wilayaCode)) {
      throw geoLocationInvalid('wilayaCode must be a two-digit official code');
    }
    if (!Number.isInteger(communeId) || communeId < 1) {
      throw geoLocationInvalid('communeId must be a positive integer');
    }
    const wilaya = await this.geo.findWilaya(wilayaCode);
    if (!wilaya) {
      throw geoWilayaNotFound();
    }
    const commune = await this.geo.findCommune(communeId);
    if (!commune) {
      throw geoCommuneNotFound();
    }
    if (commune.wilayaCode !== wilayaCode) {
      throw geoCommuneWilayaMismatch();
    }
    return {
      wilayaNameFr: wilaya.nameFr,
      communeNameFr: commune.nameFr,
    };
  }

  async resolveDisplayNames(
    wilayaCode: string | null,
    communeId: number | null,
  ): Promise<{ wilayaNameFr: string | null; communeNameFr: string | null }> {
    if (!wilayaCode || communeId === null) {
      return { wilayaNameFr: null, communeNameFr: null };
    }
    const [wilayas, communes] = await Promise.all([
      this.geo.findWilayasByCodes([wilayaCode]),
      this.geo.findCommunesByIds([communeId]),
    ]);
    return {
      wilayaNameFr: wilayas[0]?.nameFr ?? null,
      communeNameFr: communes[0]?.nameFr ?? null,
    };
  }

  async resolveDisplayNamesForBranches(
    branches: Array<{ wilayaCode: string | null; communeId: number | null }>,
  ): Promise<
    Map<string, { wilayaNameFr: string | null; communeNameFr: string | null }>
  > {
    const wilayaCodes = [
      ...new Set(
        branches
          .map((b) => b.wilayaCode)
          .filter((code): code is string => !!code),
      ),
    ];
    const communeIds = [
      ...new Set(
        branches
          .map((b) => b.communeId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const [wilayas, communes] = await Promise.all([
      this.geo.findWilayasByCodes(wilayaCodes),
      this.geo.findCommunesByIds(communeIds),
    ]);
    const wilayaByCode = new Map(wilayas.map((w) => [w.code, w.nameFr]));
    const communeById = new Map(communes.map((c) => [c.id, c.nameFr]));
    const out = new Map<
      string,
      { wilayaNameFr: string | null; communeNameFr: string | null }
    >();
    for (const branch of branches) {
      const key = `${branch.wilayaCode ?? ''}:${branch.communeId ?? ''}`;
      out.set(key, {
        wilayaNameFr: branch.wilayaCode
          ? (wilayaByCode.get(branch.wilayaCode) ?? null)
          : null,
        communeNameFr:
          branch.communeId !== null
            ? (communeById.get(branch.communeId) ?? null)
            : null,
      });
    }
    return out;
  }

  /**
   * Places Autocomplete (New). Fail-closed when GOOGLE_MAPS_API_KEY is empty.
   * Official: POST https://places.googleapis.com/v1/places:autocomplete
   * Restricted to DZ. Does not invent suggestions.
   * Responses are not cached. Place IDs may be stored; other Places content
   * is not persisted. Clients must display results on a Google Map.
   */
  async autocompletePlaces(input: {
    q: string;
    language?: string;
    sessionToken?: string;
  }): Promise<{
    configured: boolean;
    suggestions: Array<{ placeId: string; text: string }>;
  }> {
    const q = input.q.trim();
    if (q.length < 2) {
      return { configured: true, suggestions: [] };
    }
    const key = this.googleMapsApiKey();
    if (!key) {
      throw geoGeocodingNotConfigured();
    }
    const languageCode =
      input.language === 'ar' || input.language === 'fr'
        ? input.language
        : 'fr';
    const response = await this.googleFetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
        },
        body: JSON.stringify({
          input: q,
          includedRegionCodes: ['dz'],
          regionCode: 'dz',
          languageCode,
          ...(input.sessionToken?.trim()
            ? { sessionToken: input.sessionToken.trim() }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      throw geoLocationInvalid('Address search provider request failed');
    }
    const body = (await response.json()) as {
      suggestions?: Array<{
        placePrediction?: { placeId?: string; text?: { text?: string } };
      }>;
    };
    const suggestions = (body.suggestions ?? [])
      .map((row) => ({
        placeId: row.placePrediction?.placeId ?? '',
        text: row.placePrediction?.text?.text ?? '',
      }))
      .filter((row) => row.placeId && row.text);
    return { configured: true, suggestions };
  }

  /**
   * Reverse geocode a confirmed map pin. Fail-closed when the key is empty.
   * Official Geocoding API latlng. Never overwrites a newer client selection
   * — callers must apply generation tokens.
   */
  async reverseGeocode(input: {
    latitude: number;
    longitude: number;
    language?: string;
  }): Promise<{ configured: boolean; formattedAddress: string | null }> {
    if (
      !Number.isFinite(input.latitude) ||
      !Number.isFinite(input.longitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      input.longitude < -180 ||
      input.longitude > 180 ||
      (input.latitude === 0 && input.longitude === 0)
    ) {
      throw geoLocationInvalid('Coordinates are outside the allowed range');
    }
    const key = this.googleMapsApiKey();
    if (!key) {
      throw geoGeocodingNotConfigured();
    }
    const language =
      input.language === 'ar' || input.language === 'fr'
        ? input.language
        : 'fr';
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set(
      'latlng',
      `${input.latitude.toFixed(6)},${input.longitude.toFixed(6)}`,
    );
    url.searchParams.set('key', key);
    url.searchParams.set('language', language);
    url.searchParams.set('region', 'dz');
    const response = await this.googleFetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      throw geoLocationInvalid('Reverse geocoding provider request failed');
    }
    const body = (await response.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string }>;
    };
    if (body.status === 'ZERO_RESULTS') {
      return { configured: true, formattedAddress: null };
    }
    if (body.status && body.status !== 'OK') {
      throw geoLocationInvalid('Reverse geocoding provider request failed');
    }
    const formatted = body.results?.[0]?.formatted_address?.trim() ?? null;
    return { configured: true, formattedAddress: formatted };
  }

  /**
   * Place Details (New) for a suggestion the user tapped.
   * Official: GET https://places.googleapis.com/v1/places/{placeId}
   * Returns coordinates for the client to move the map — never a substitute
   * for a later confirmed pin.
   */
  async resolvePlace(input: {
    placeId: string;
    language?: string;
    sessionToken?: string;
  }): Promise<{
    configured: boolean;
    placeId: string;
    formattedAddress: string | null;
    latitude: number;
    longitude: number;
  }> {
    const placeId = input.placeId.trim();
    if (!placeId || placeId.length > 256) {
      throw geoLocationInvalid('placeId is required');
    }
    const key = this.googleMapsApiKey();
    if (!key) {
      throw geoGeocodingNotConfigured();
    }
    const languageCode =
      input.language === 'ar' || input.language === 'fr'
        ? input.language
        : 'fr';
    const id = placeId.startsWith('places/')
      ? placeId.slice('places/'.length)
      : placeId;
    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
    );
    url.searchParams.set('languageCode', languageCode);
    const sessionToken = input.sessionToken?.trim();
    if (sessionToken) {
      url.searchParams.set('sessionToken', sessionToken);
    }
    const response = await this.googleFetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'id,formattedAddress,location',
      },
    });
    if (!response.ok) {
      throw geoLocationInvalid('Place details provider request failed');
    }
    const body = (await response.json()) as {
      id?: string;
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    const latitude = body.location?.latitude;
    const longitude = body.location?.longitude;
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      (latitude === 0 && longitude === 0)
    ) {
      throw geoLocationInvalid('Place details did not include a usable point');
    }
    return {
      configured: true,
      placeId: body.id ?? id,
      formattedAddress: body.formattedAddress?.trim() || null,
      latitude,
      longitude,
    };
  }
}
