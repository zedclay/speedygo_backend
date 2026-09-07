/** Supported time-band labels for DeliveryPricingRule v1.0. */
export const DELIVERY_TIME_BANDS = ['DAY', 'NIGHT', 'CUSTOM'] as const;
export type DeliveryTimeBand = (typeof DELIVERY_TIME_BANDS)[number];

/** Domain record for a DeliveryZone row, with geometry returned as GeoJSON string. */
export type DeliveryZoneRecord = {
  id: string;
  name: string;
  /** GeoJSON MultiPolygon string as returned by ST_AsGeoJSON. */
  geometryGeoJson: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Domain record for a DeliveryPricingRule row. Money fields are bigint for exact arithmetic. */
export type DeliveryPricingRuleRecord = {
  id: string;
  zoneId: string;
  name: string;
  timeBand: DeliveryTimeBand;
  startLocalTime: string | null;
  endLocalTime: string | null;
  customerDeliveryFeeMinor: bigint;
  driverRemunerationMinor: bigint;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Validated GeoJSON Polygon coordinates extracted from admin input. */
export type ValidatedPolygonInput = {
  type: 'Polygon';
  /** Array of rings; v1.0 always has exactly one ring (no holes). */
  coordinates: Array<Array<[number, number]>>;
};

/** Multipolygon geometry object for Prisma ORM create/update. */
export type MultiPolygonGeometryInput = {
  type: 'MultiPolygon';
  coordinates: Array<Array<Array<[number, number]>>>;
  srid: 4326;
};

/** Input for creating a DeliveryZone (admin). */
export type CreateDeliveryZoneInput = {
  name: string;
  /** Validated polygon extracted from admin GeoJSON input. */
  polygon: ValidatedPolygonInput;
};

/** Input for updating a DeliveryZone (admin). */
export type UpdateDeliveryZoneInput = {
  id: string;
  name?: string;
  /** Validated polygon, present only if geometry is being updated. */
  polygon?: ValidatedPolygonInput;
};

/** Input for creating a DeliveryPricingRule (admin). */
export type CreateDeliveryPricingRuleInput = {
  zoneId: string;
  name: string;
  timeBand: DeliveryTimeBand;
  startLocalTime: string | null;
  endLocalTime: string | null;
  customerDeliveryFeeMinor: bigint;
  driverRemunerationMinor: bigint;
  effectiveFrom: string;
  effectiveTo: string | null;
};
