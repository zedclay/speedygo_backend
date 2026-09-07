/**
 * Geometry policy for Admin Delivery Zones v1.0.
 *
 * Admin input is a plain GeoJSON Polygon (no Feature/FeatureCollection wrapper,
 * no holes, no MultiPolygon). The service wraps it into a MultiPolygon for storage.
 *
 * All spatial validity (ST_IsValid) and overlap checks are delegated to PostGIS
 * via the repository and executed inside the mutation transaction.
 */

import { deliveryZoneInvalidGeometry } from './delivery-pricing.errors';
import type { ValidatedPolygonInput } from './delivery-pricing.types';

/** Maximum allowed positions in the outer ring (v1.0 hard cap). */
export const POLYGON_MAX_POSITIONS = 2000;
/** Minimum required positions (closed ring → 4 = 3 distinct + 1 closing). */
export const POLYGON_MIN_POSITIONS = 4;

/**
 * Validate and parse a raw GeoJSON Polygon from admin input.
 *
 * Checks (pure JS — fast-fail before any PostGIS round-trip):
 *  1. Object with type === 'Polygon' — rejects Feature, FeatureCollection, MultiPolygon
 *  2. Exactly one ring (no holes)
 *  3. 4–2000 positions
 *  4. Each position: finite lon ∈ [-180,180], lat ∈ [-90,90]
 *  5. Closed ring (first === last position)
 *  6. ≥ 3 distinct vertices (excluding closing repeat)
 *  7. Non-zero shoelace area (detects collinear / degenerate polygons)
 *
 * Self-intersection and full topology validity are checked via PostGIS ST_IsValid
 * in the repository.
 */
export function validateAdminPolygonInput(raw: unknown): ValidatedPolygonInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw deliveryZoneInvalidGeometry(
      'geometry must be a GeoJSON Polygon object',
    );
  }
  const obj = raw as Record<string, unknown>;

  // Reject Feature/FeatureCollection wrappers
  if (obj.type === 'Feature' || obj.type === 'FeatureCollection') {
    throw deliveryZoneInvalidGeometry(
      'FeatureCollection/Feature not accepted; provide a plain GeoJSON Polygon',
    );
  }
  // Reject MultiPolygon input
  if (obj.type === 'MultiPolygon') {
    throw deliveryZoneInvalidGeometry(
      'MultiPolygon input is not accepted in v1.0; provide a single Polygon',
    );
  }
  if (obj.type !== 'Polygon') {
    throw deliveryZoneInvalidGeometry(
      `GeoJSON type must be "Polygon", got: ${String(obj.type)}`,
    );
  }

  if (!Array.isArray(obj.coordinates)) {
    throw deliveryZoneInvalidGeometry(
      'GeoJSON Polygon must have a "coordinates" array',
    );
  }
  // Explicitly cast to unknown[] to avoid the any[] narrowing from Array.isArray
  const coordsRaw = obj.coordinates as unknown[];

  // No holes — exactly one ring
  if (coordsRaw.length !== 1) {
    throw deliveryZoneInvalidGeometry(
      'Polygon must not contain holes (exactly one ring allowed in v1.0)',
    );
  }

  const ring: unknown = coordsRaw[0];
  if (!Array.isArray(ring)) {
    throw deliveryZoneInvalidGeometry(
      'Polygon ring must be an array of positions',
    );
  }
  const ringArr = ring as unknown[];

  // Position count
  if (ringArr.length < POLYGON_MIN_POSITIONS) {
    throw deliveryZoneInvalidGeometry(
      `Polygon ring must have at least ${POLYGON_MIN_POSITIONS} positions (closed ring with 3 distinct vertices); got ${ringArr.length}`,
    );
  }
  if (ringArr.length > POLYGON_MAX_POSITIONS) {
    throw deliveryZoneInvalidGeometry(
      `Polygon ring must not exceed ${POLYGON_MAX_POSITIONS} positions; got ${ringArr.length}`,
    );
  }

  // Validate each position
  const positions: Array<[number, number]> = [];
  for (let i = 0; i < ringArr.length; i++) {
    const pos: unknown = ringArr[i];
    if (!Array.isArray(pos) || pos.length < 2) {
      throw deliveryZoneInvalidGeometry(
        `Position ${i} must be [longitude, latitude]`,
      );
    }
    const posArr = pos as unknown[];
    const lon: unknown = posArr[0];
    const lat: unknown = posArr[1];
    if (typeof lon !== 'number' || !Number.isFinite(lon)) {
      throw deliveryZoneInvalidGeometry(
        `Position ${i}: longitude must be a finite number`,
      );
    }
    if (typeof lat !== 'number' || !Number.isFinite(lat)) {
      throw deliveryZoneInvalidGeometry(
        `Position ${i}: latitude must be a finite number`,
      );
    }
    if (lon < -180 || lon > 180) {
      throw deliveryZoneInvalidGeometry(
        `Position ${i}: longitude ${lon} is out of range [-180, 180]`,
      );
    }
    if (lat < -90 || lat > 90) {
      throw deliveryZoneInvalidGeometry(
        `Position ${i}: latitude ${lat} is out of range [-90, 90]`,
      );
    }
    positions.push([lon, lat]);
  }

  // Closed ring check
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw deliveryZoneInvalidGeometry(
      'Polygon ring must be closed: first and last positions must be identical',
    );
  }

  // Distinct vertices (excluding the closing repeat)
  const withoutClose = positions.slice(0, -1);
  const distinctKeys = new Set<string>(
    withoutClose.map(([lon, lat]) => `${lon},${lat}`),
  );
  if (distinctKeys.size < 3) {
    throw deliveryZoneInvalidGeometry(
      `Polygon must have at least 3 distinct vertices; found ${distinctKeys.size}`,
    );
  }

  // Non-zero area (shoelace formula on lon/lat — catches collinear/degenerate)
  const area = shoelaceArea2D(withoutClose);
  if (area <= 0) {
    throw deliveryZoneInvalidGeometry(
      'Polygon has zero or degenerate area; all vertices may be collinear',
    );
  }

  return {
    type: 'Polygon',
    coordinates: [positions],
  };
}

/**
 * Wrap a validated Polygon into the MultiPolygon geometry input expected by the ORM.
 * Spec: admin inputs Polygon; storage is always MultiPolygon with SRID 4326.
 */
export function wrapPolygonAsMultiPolygon(polygon: ValidatedPolygonInput): {
  type: 'MultiPolygon';
  coordinates: Array<Array<Array<[number, number]>>>;
  srid: 4326;
} {
  return {
    type: 'MultiPolygon',
    coordinates: [polygon.coordinates],
    srid: 4326,
  };
}

/**
 * Shoelace formula for signed area of a 2D polygon.
 * Works in lon/lat coordinate space — only used to detect zero-area degeneracy.
 */
function shoelaceArea2D(vertices: Array<[number, number]>): number {
  const n = vertices.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area / 2);
}
