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
    await client
      .multi()
      .geoadd(this.geoKey(), longitude, latitude, driverId)
      .hset(this.locKey(driverId), {
        latitude: String(latitude),
        longitude: String(longitude),
        recordedAt,
      })
      .exec();
    return { driverId, latitude, longitude, recordedAt };
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
