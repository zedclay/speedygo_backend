import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import { driverLocationInvalid } from '../domain/matching.errors';
import { isLocationFresh, isValidLocation } from '../domain/matching.policy';
import type {
  DriverLocationRecord,
  DriverLocationStore,
  GeoCandidate,
} from '../domain/matching.types';

const UPSERT_IF_NEWER_LUA = `
local loc = KEYS[1]
local geo = KEYS[2]
local recordedAt = ARGV[1]
local latitude = ARGV[2]
local longitude = ARGV[3]
local driverId = ARGV[4]
local ttl = tonumber(ARGV[5])
local accuracy = ARGV[6]
local current = redis.call('HGET', loc, 'recordedAt')
if current and current >= recordedAt then
  return 0
end
redis.call('GEOADD', geo, longitude, latitude, driverId)
if accuracy ~= '' then
  redis.call('HSET', loc, 'latitude', latitude, 'longitude', longitude, 'recordedAt', recordedAt, 'accuracyMeters', accuracy)
else
  redis.call('HSET', loc, 'latitude', latitude, 'longitude', longitude, 'recordedAt', recordedAt)
  redis.call('HDEL', loc, 'accuracyMeters')
end
if ttl > 0 then
  redis.call('PEXPIRE', loc, ttl)
end
return 1
`;

@Injectable()
export class RedisDriverLocationStore implements DriverLocationStore {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private prefix(): string {
    return this.config.get<string>('matching.redisKeyPrefix', 'matching:');
  }

  private geoKey(): string {
    return `${this.prefix()}geo`;
  }

  private locKey(driverId: string): string {
    return `${this.prefix()}loc:${driverId}`;
  }

  private ttlMs(): number {
    return this.config.get<number>('tracking.locationTtlMs', 600_000);
  }

  async upsert(
    driverId: string,
    latitude: number,
    longitude: number,
    recordedAt = new Date().toISOString(),
  ): Promise<DriverLocationRecord> {
    if (!isValidLocation(latitude, longitude) || !Date.parse(recordedAt)) {
      throw driverLocationInvalid();
    }
    const client = this.redis.getClient();
    const loc = this.locKey(driverId);
    const ttl = this.ttlMs();
    const chain = client
      .multi()
      .geoadd(this.geoKey(), longitude, latitude, driverId)
      .hset(loc, {
        latitude: String(latitude),
        longitude: String(longitude),
        recordedAt,
      });
    if (ttl > 0) {
      chain.pexpire(loc, ttl);
    }
    await chain.exec();
    return { driverId, latitude, longitude, recordedAt };
  }

  /**
   * Server-authoritative write. Older recordedAt values do not overwrite newer.
   * GEO + hash update in one Lua eval so a missing hash cannot match as fresh.
   */
  async upsertIfNewer(
    driverId: string,
    latitude: number,
    longitude: number,
    recordedAt: string,
    accuracyMeters?: number | null,
  ): Promise<{ record: DriverLocationRecord; applied: boolean }> {
    if (!isValidLocation(latitude, longitude) || !Date.parse(recordedAt)) {
      throw driverLocationInvalid();
    }
    const ttl = this.ttlMs();
    const accuracy =
      accuracyMeters === undefined || accuracyMeters === null
        ? ''
        : String(accuracyMeters);
    const applied = await this.redis
      .getClient()
      .eval(
        UPSERT_IF_NEWER_LUA,
        2,
        this.locKey(driverId),
        this.geoKey(),
        recordedAt,
        String(latitude),
        String(longitude),
        driverId,
        String(ttl > 0 ? ttl : 0),
        accuracy,
      );
    const current = await this.get(driverId);
    const record =
      current ??
      ({
        driverId,
        latitude,
        longitude,
        recordedAt,
      } satisfies DriverLocationRecord);
    return { record, applied: Number(applied) === 1 };
  }

  async removeStaleGeoMembers(
    maxAgeMs: number,
    limit: number,
  ): Promise<number> {
    if (maxAgeMs <= 0 || limit <= 0) {
      return 0;
    }
    const members = await this.redis
      .getClient()
      .zrange(this.geoKey(), '0', String(limit - 1));
    let removed = 0;
    for (const driverId of members) {
      const location = await this.get(driverId);
      if (!location || !isLocationFresh(location.recordedAt, maxAgeMs)) {
        await this.redis.getClient().zrem(this.geoKey(), driverId);
        removed += 1;
      }
    }
    return removed;
  }

  async get(driverId: string): Promise<DriverLocationRecord | null> {
    const hash = await this.redis.getClient().hgetall(this.locKey(driverId));
    if (!hash.latitude || !hash.longitude || !hash.recordedAt) {
      return null;
    }
    const latitude = Number(hash.latitude);
    const longitude = Number(hash.longitude);
    if (!isValidLocation(latitude, longitude)) {
      return null;
    }
    return {
      driverId,
      latitude,
      longitude,
      recordedAt: hash.recordedAt,
    };
  }

  async searchNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
  ): Promise<GeoCandidate[]> {
    if (
      !isValidLocation(latitude, longitude) ||
      radiusMeters <= 0 ||
      limit <= 0
    ) {
      return [];
    }
    const rows = (await this.redis
      .getClient()
      .georadius(
        this.geoKey(),
        longitude,
        latitude,
        radiusMeters,
        'm',
        'WITHDIST',
        'ASC',
        'COUNT',
        limit,
      )) as Array<[string, string]>;
    const maxAgeMs = this.config.get<number>(
      'matching.locationMaxAgeMs',
      45_000,
    );
    const fresh: GeoCandidate[] = [];
    for (const [driverId, distance] of rows ?? []) {
      const location = await this.get(driverId);
      if (!location || !isLocationFresh(location.recordedAt, maxAgeMs)) {
        continue;
      }
      fresh.push({
        driverId,
        distanceMeters: Number(distance),
        recordedAt: location.recordedAt,
      });
    }
    return fresh;
  }
}
