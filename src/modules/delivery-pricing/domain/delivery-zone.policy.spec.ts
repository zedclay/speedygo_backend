import {
  validateAdminPolygonInput,
  wrapPolygonAsMultiPolygon,
} from './delivery-zone.policy';
import { DeliveryPricingError } from './delivery-pricing.errors';

describe('delivery-zone.policy', () => {
  describe('validateAdminPolygonInput', () => {
    const VALID_RING: Array<[number, number]> = [
      [3.0, 36.7],
      [3.1, 36.7],
      [3.1, 36.8],
      [3.0, 36.8],
      [3.0, 36.7],
    ];

    it('accepts a valid closed GeoJSON Polygon', () => {
      const result = validateAdminPolygonInput({
        type: 'Polygon',
        coordinates: [VALID_RING],
      });
      expect(result.type).toBe('Polygon');
      expect(result.coordinates[0]).toHaveLength(VALID_RING.length);
    });

    it('rejects FeatureCollection', () => {
      expect(() =>
        validateAdminPolygonInput({ type: 'FeatureCollection', features: [] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects Feature wrapper', () => {
      expect(() =>
        validateAdminPolygonInput({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [VALID_RING] },
          properties: {},
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects MultiPolygon input', () => {
      expect(() =>
        validateAdminPolygonInput({
          type: 'MultiPolygon',
          coordinates: [[VALID_RING]],
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects non-Polygon type', () => {
      expect(() =>
        validateAdminPolygonInput({ type: 'Point', coordinates: [3.0, 36.7] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects Polygon with a hole (2+ rings)', () => {
      const innerRing: Array<[number, number]> = [
        [3.02, 36.72],
        [3.08, 36.72],
        [3.08, 36.78],
        [3.02, 36.72],
      ];
      expect(() =>
        validateAdminPolygonInput({
          type: 'Polygon',
          coordinates: [VALID_RING, innerRing],
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects fewer than 4 positions', () => {
      expect(() =>
        validateAdminPolygonInput({
          type: 'Polygon',
          coordinates: [
            [
              [3.0, 36.7],
              [3.1, 36.7],
              [3.0, 36.7],
            ],
          ],
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects more than 2000 positions', () => {
      const bigRing: Array<[number, number]> = [];
      for (let i = 0; i <= 2000; i++) {
        bigRing.push([3.0 + i * 0.00001, 36.7]);
      }
      bigRing.push(bigRing[0]);
      expect(() =>
        validateAdminPolygonInput({ type: 'Polygon', coordinates: [bigRing] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects longitude out of range', () => {
      const badRing: Array<[number, number]> = [
        [200, 36.7],
        [3.1, 36.7],
        [3.1, 36.8],
        [200, 36.7],
      ];
      expect(() =>
        validateAdminPolygonInput({ type: 'Polygon', coordinates: [badRing] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects latitude out of range', () => {
      const badRing: Array<[number, number]> = [
        [3.0, 100],
        [3.1, 100],
        [3.1, 36.8],
        [3.0, 100],
      ];
      expect(() =>
        validateAdminPolygonInput({ type: 'Polygon', coordinates: [badRing] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects non-finite coordinates', () => {
      const nanRing: Array<[number, number]> = [
        [NaN, 36.7],
        [3.1, 36.7],
        [3.1, 36.8],
        [NaN, 36.7],
      ];
      expect(() =>
        validateAdminPolygonInput({ type: 'Polygon', coordinates: [nanRing] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects unclosed ring (first !== last)', () => {
      const open: Array<[number, number]> = [
        [3.0, 36.7],
        [3.1, 36.7],
        [3.1, 36.8],
        [3.0, 36.8],
      ];
      expect(() =>
        validateAdminPolygonInput({ type: 'Polygon', coordinates: [open] }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects fewer than 3 distinct vertices', () => {
      // Only 2 distinct: collinear back-and-forth
      const degenerate: Array<[number, number]> = [
        [3.0, 36.7],
        [3.1, 36.7],
        [3.0, 36.7],
        [3.1, 36.7],
        [3.0, 36.7],
      ];
      expect(() =>
        validateAdminPolygonInput({
          type: 'Polygon',
          coordinates: [degenerate],
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects zero-area (collinear) polygon', () => {
      // All on the same horizontal line
      const collinear: Array<[number, number]> = [
        [3.0, 36.7],
        [3.05, 36.7],
        [3.1, 36.7],
        [3.05, 36.7],
        [3.0, 36.7],
      ];
      expect(() =>
        validateAdminPolygonInput({
          type: 'Polygon',
          coordinates: [collinear],
        }),
      ).toThrow(DeliveryPricingError);
    });

    it('rejects null/primitive input', () => {
      expect(() => validateAdminPolygonInput(null)).toThrow(
        DeliveryPricingError,
      );
      expect(() => validateAdminPolygonInput('string')).toThrow(
        DeliveryPricingError,
      );
    });

    it('stores the correct error code DELIVERY_ZONE_INVALID_GEOMETRY', () => {
      try {
        validateAdminPolygonInput({ type: 'FeatureCollection', features: [] });
        expect(true).toBe(false); // Should have thrown
      } catch (err) {
        expect((err as DeliveryPricingError).code).toBe(
          'DELIVERY_ZONE_INVALID_GEOMETRY',
        );
      }
    });
  });

  describe('wrapPolygonAsMultiPolygon', () => {
    it('wraps Polygon into MultiPolygon with SRID 4326', () => {
      const ring: Array<[number, number]> = [
        [3.0, 36.7],
        [3.1, 36.7],
        [3.1, 36.8],
        [3.0, 36.7],
      ];
      const polygon = { type: 'Polygon' as const, coordinates: [ring] };
      const mp = wrapPolygonAsMultiPolygon(polygon);
      expect(mp.type).toBe('MultiPolygon');
      expect(mp.srid).toBe(4326);
      expect(mp.coordinates).toEqual([[ring]]);
    });
  });
});
