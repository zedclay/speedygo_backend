import { Injectable } from '@nestjs/common';
import {
  geoCommuneNotFound,
  geoCommuneWilayaMismatch,
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
  constructor(private readonly geo: GeoRepository) {}

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
}
