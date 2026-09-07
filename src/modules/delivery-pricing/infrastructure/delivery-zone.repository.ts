import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import {
  DELIVERY_ZONE_TOPOLOGY_LOCK_CLASS,
  DELIVERY_ZONE_TOPOLOGY_LOCK_OBJECT,
} from '../domain/delivery-pricing.lock';
import {
  deliveryZoneNotFound,
  deliveryZoneInvalidGeometry,
  deliveryZoneOverlap,
} from '../domain/delivery-pricing.errors';
import type {
  DeliveryZoneRecord,
  ValidatedPolygonInput,
} from '../domain/delivery-pricing.types';
import { wrapPolygonAsMultiPolygon } from '../domain/delivery-zone.policy';

/**
 * Minimal ORM-only client for methods shared across the normal connection and
 * a transaction client (the Prisma 8 transaction callback argument has all ORM
 * operations available).
 */
export type ZoneOrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: ZoneOrmClient) {
  return client.orm.public;
}

type RawZoneRow = {
  id: string;
  name: string;
  active: string;
  created_at: string;
  updated_at: string;
  geometry_geojson: string;
};

function toZoneRecord(row: RawZoneRow): DeliveryZoneRecord {
  return {
    id: row.id,
    name: String(row.name),
    geometryGeoJson: String(row.geometry_geojson),
    active: row.active === 'true' || row.active === 't',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type AdminDeliveryZoneListQuery = {
  limit: number;
  offset: number;
  active?: boolean;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortDir?: 'ASC' | 'DESC';
};

@Injectable()
export class DeliveryZoneRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  /**
   * Check PostGIS spatial validity of a GeoJSON polygon via ST_IsValid.
   * Always uses the default connection (not a transaction client).
   */
  async checkSpatialValid(
    polygon: ValidatedPolygonInput,
  ): Promise<{ valid: boolean; reason: string | null }> {
    const db = this.db();
    const geoJsonStr = JSON.stringify(polygon);
    const plan = db.raw.sql`
      SELECT
        (ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${geoJsonStr}), 4326)))::text AS is_valid,
        ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON(${geoJsonStr}), 4326)) AS reason
    `
      .returnsRow({
        is_valid: 'sql/varchar@1' as const,
        reason: { codecId: 'sql/varchar@1' as const, nullable: true },
      })
      .build();

    const rows = await db.runtime().query(plan);
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first) {
      return { valid: false, reason: 'ST_IsValid returned no rows' };
    }
    return {
      valid:
        String(first.is_valid) === 'true' || String(first.is_valid) === 't',
      reason: first.reason ? String(first.reason) : null,
    };
  }

  /**
   * Active zones whose interiors intersect the candidate polygon.
   * Boundary-only touching (ST_Touches) is allowed; containment/identical/partial
   * interior overlap is rejected via ST_Intersects AND NOT ST_Touches.
   */
  async findInteriorOverlappingActiveZoneIds(
    polygon: ValidatedPolygonInput,
    excludeZoneId: string | null,
  ): Promise<string[]> {
    const db = this.db();
    const multi = wrapPolygonAsMultiPolygon(polygon);
    const multiJson = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: multi.coordinates,
    });

    if (excludeZoneId !== null) {
      const plan = db.raw.sql`
        SELECT id FROM delivery_zones
        WHERE active = true
          AND id != ${excludeZoneId}
          AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON(${multiJson}), 4326))
          AND NOT ST_Touches(geometry, ST_SetSRID(ST_GeomFromGeoJSON(${multiJson}), 4326))
      `
        .returnsRow({ id: 'pg/uuid@1' as const })
        .build();
      const rows = await db.runtime().query(plan);
      return (Array.isArray(rows) ? rows : []).map((r) => String(r.id));
    }
    const plan = db.raw.sql`
      SELECT id FROM delivery_zones
      WHERE active = true
        AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON(${multiJson}), 4326))
        AND NOT ST_Touches(geometry, ST_SetSRID(ST_GeomFromGeoJSON(${multiJson}), 4326))
    `
      .returnsRow({ id: 'pg/uuid@1' as const })
      .build();
    const rows = await db.runtime().query(plan);
    return (Array.isArray(rows) ? rows : []).map((r) => String(r.id));
  }

  /**
   * Interior-overlap check using the zone's stored geometry (preserves MultiPolygon
   * parts/holes already in DB — does not reparse Admin Polygon DTO).
   */
  async findInteriorOverlappingActiveZoneIdsForStoredZone(
    zoneId: string,
  ): Promise<string[]> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT z.id FROM delivery_zones z
      WHERE z.active = true
        AND z.id != ${zoneId}
        AND ST_Intersects(
          z.geometry,
          (SELECT geometry FROM delivery_zones WHERE id = ${zoneId})
        )
        AND NOT ST_Touches(
          z.geometry,
          (SELECT geometry FROM delivery_zones WHERE id = ${zoneId})
        )
    `
      .returnsRow({ id: 'pg/uuid@1' as const })
      .build();
    const rows = await db.runtime().query(plan);
    return (Array.isArray(rows) ? rows : []).map((r) => String(r.id));
  }

  /**
   * Find zone by id including geometry via ST_AsGeoJSON.
   * Uses the default connection.
   */
  async findById(id: string): Promise<DeliveryZoneRecord | null> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT
        id, name, active::text AS active,
        created_at::text AS created_at,
        updated_at::text AS updated_at,
        ST_AsGeoJSON(geometry) AS geometry_geojson
      FROM delivery_zones
      WHERE id = ${id}
    `
      .returnsRow({
        id: 'pg/uuid@1' as const,
        name: 'sql/varchar@1' as const,
        active: 'sql/varchar@1' as const,
        created_at: 'sql/varchar@1' as const,
        updated_at: 'sql/varchar@1' as const,
        geometry_geojson: 'sql/varchar@1' as const,
      })
      .build();

    const rows = await db.runtime().query(plan);
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first) return null;
    return toZoneRecord(first);
  }

  /**
   * Check zone exists using ORM (no geometry needed, used inside transactions).
   */
  async findByIdORM(
    id: string,
    client?: ZoneOrmClient,
  ): Promise<{ id: string; active: boolean; name: string } | null> {
    const row = await orm(client ?? this.db())
      .DeliveryZone.where({ id })
      .first();
    if (!row) return null;
    return { id: row.id, name: String(row.name), active: Boolean(row.active) };
  }

  /**
   * Paginated list of zones with ST_AsGeoJSON geometry.
   */
  async list(query: AdminDeliveryZoneListQuery): Promise<{
    items: DeliveryZoneRecord[];
    total: number;
  }> {
    const db = this.db();
    const { limit, offset } = query;
    const sortAsc = query.sortDir === 'ASC';
    const sortByName = query.sortBy === 'name';

    let total = 0;
    let pageRows: RawZoneRow[] = [];

    if (query.active !== undefined) {
      const activeBool = query.active;
      const countPlan = db.raw.sql`
        SELECT COUNT(*)::text AS total FROM delivery_zones WHERE active = ${activeBool}
      `
        .returnsRow({ total: 'sql/varchar@1' as const })
        .build();
      const countRows = await db.runtime().query(countPlan);
      total = Number(
        Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0,
      );

      if (sortByName && sortAsc) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones WHERE active = ${activeBool} ORDER BY name ASC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else if (sortByName) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones WHERE active = ${activeBool} ORDER BY name DESC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else if (sortAsc) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones WHERE active = ${activeBool} ORDER BY created_at ASC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones WHERE active = ${activeBool} ORDER BY created_at DESC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      }
    } else {
      const countPlan = db.raw.sql`
        SELECT COUNT(*)::text AS total FROM delivery_zones
      `
        .returnsRow({ total: 'sql/varchar@1' as const })
        .build();
      const countRows = await db.runtime().query(countPlan);
      total = Number(
        Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0,
      );

      if (sortByName && sortAsc) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones ORDER BY name ASC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else if (sortByName) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones ORDER BY name DESC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else if (sortAsc) {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones ORDER BY created_at ASC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      } else {
        const plan = db.raw
          .sql`SELECT id, name, active::text AS active, created_at::text AS created_at, updated_at::text AS updated_at, ST_AsGeoJSON(geometry) AS geometry_geojson FROM delivery_zones ORDER BY created_at DESC, id ASC LIMIT ${limit} OFFSET ${offset}`
          .returnsRow({
            id: 'pg/uuid@1' as const,
            name: 'sql/varchar@1' as const,
            active: 'sql/varchar@1' as const,
            created_at: 'sql/varchar@1' as const,
            updated_at: 'sql/varchar@1' as const,
            geometry_geojson: 'sql/varchar@1' as const,
          })
          .build();
        const r = await db.runtime().query(plan);
        pageRows = Array.isArray(r) ? r : [];
      }
    }

    return { items: pageRows.map(toZoneRecord), total };
  }

  async create(
    input: {
      name: string;
      polygon: ValidatedPolygonInput;
      active?: boolean;
    },
    client?: ZoneOrmClient,
  ): Promise<DeliveryZoneRecord> {
    const id = createUuidV7();
    const now = pgNow();
    const active = input.active ?? false;
    const geometry = wrapPolygonAsMultiPolygon(input.polygon);
    await orm(client ?? this.db()).DeliveryZone.create({
      id,
      name: pgVarchar<255>(input.name),
      geometry,
      active,
      createdAt: now,
      updatedAt: now,
    });
    // Do not re-query via a separate connection while inside a TX — the row
    // is not visible until commit. Return the authoritative written values.
    return {
      id,
      name: input.name,
      geometryGeoJson: JSON.stringify({
        type: 'MultiPolygon',
        coordinates: geometry.coordinates,
      }),
      active,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(
    id: string,
    input: { name?: string; polygon?: ValidatedPolygonInput },
    client?: ZoneOrmClient,
  ): Promise<DeliveryZoneRecord> {
    const existing = await this.findByIdORM(id, client);
    if (!existing) {
      throw deliveryZoneNotFound();
    }
    // Geometry read uses the default connection — only valid for already-committed rows.
    const prior = await this.findById(id);
    const now = pgNow();
    const updateFields: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) {
      updateFields.name = pgVarchar<255>(input.name);
    }
    let geometryGeoJson =
      prior?.geometryGeoJson ??
      JSON.stringify({ type: 'MultiPolygon', coordinates: [] });
    if (input.polygon !== undefined) {
      const geometry = wrapPolygonAsMultiPolygon(input.polygon);
      updateFields.geometry = geometry;
      geometryGeoJson = JSON.stringify({
        type: 'MultiPolygon',
        coordinates: geometry.coordinates,
      });
    }
    await orm(client ?? this.db())
      .DeliveryZone.where({ id })
      .update(updateFields);

    return {
      id,
      name: input.name ?? existing.name,
      geometryGeoJson,
      active: existing.active,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async setActive(
    id: string,
    active: boolean,
    client?: ZoneOrmClient,
  ): Promise<DeliveryZoneRecord> {
    const existing = await this.findByIdORM(id, client);
    if (!existing) {
      throw deliveryZoneNotFound();
    }
    const prior = await this.findById(id);
    const now = pgNow();
    await orm(client ?? this.db())
      .DeliveryZone.where({ id })
      .update({
        active,
        updatedAt: now,
      });
    return {
      id,
      name: existing.name,
      geometryGeoJson:
        prior?.geometryGeoJson ??
        JSON.stringify({ type: 'MultiPolygon', coordinates: [] }),
      active,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async requireById(
    id: string,
    client?: ZoneOrmClient,
  ): Promise<DeliveryZoneRecord> {
    // Use findByIdORM for existence check (avoids raw SQL in transaction path),
    // then fetch with geometry for the return value.
    const exists = await this.findByIdORM(id, client);
    if (!exists) throw deliveryZoneNotFound();
    const full = await this.findById(id);
    if (!full) throw deliveryZoneNotFound();
    return full;
  }

  async requireSpatialValid(polygon: ValidatedPolygonInput): Promise<void> {
    const result = await this.checkSpatialValid(polygon);
    if (!result.valid) {
      throw deliveryZoneInvalidGeometry(
        result.reason
          ? `PostGIS ST_IsValid failed: ${result.reason}`
          : 'PostGIS ST_IsValid failed',
      );
    }
  }

  /**
   * Transaction-scoped global advisory lock for active-zone topology mutations.
   */
  async lockActiveZoneTopology(client: ZoneOrmClient): Promise<void> {
    if (typeof (client as { query?: unknown }).query !== 'function') {
      return;
    }
    const query = (client as { query: (plan: unknown) => unknown }).query.bind(
      client,
    );
    const plan = this.db().raw.sql`
      SELECT 1::int4 AS locked
      WHERE (
        SELECT CASE
          WHEN pg_advisory_xact_lock(
            ${DELIVERY_ZONE_TOPOLOGY_LOCK_CLASS},
            ${DELIVERY_ZONE_TOPOLOGY_LOCK_OBJECT}
          ) IS NULL THEN 1
          ELSE 1
        END
      ) = 1
    `
      .returnsRow({ locked: 'pg/int4@1' as const })
      .build();
    await query(plan);
  }

  async requireNoActiveInteriorOverlap(
    polygon: ValidatedPolygonInput,
    excludeZoneId: string | null,
  ): Promise<void> {
    const ids = await this.findInteriorOverlappingActiveZoneIds(
      polygon,
      excludeZoneId,
    );
    if (ids.length > 0) {
      throw deliveryZoneOverlap(
        `Geometry interior overlaps existing active zone(s): ${ids.join(', ')}`,
      );
    }
  }

  async requireNoActiveInteriorOverlapForStoredZone(
    zoneId: string,
  ): Promise<void> {
    const ids =
      await this.findInteriorOverlappingActiveZoneIdsForStoredZone(zoneId);
    if (ids.length > 0) {
      throw deliveryZoneOverlap(
        `Geometry interior overlaps existing active zone(s): ${ids.join(', ')}`,
      );
    }
  }
}
