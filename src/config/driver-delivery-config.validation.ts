export type DriverDeliveryRuntimeConfig = {
  pickupRadiusMeters: number;
  dropoffRadiusMeters: number;
};

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function assertDriverDeliveryConfig(
  config: DriverDeliveryRuntimeConfig,
): void {
  requirePositiveInteger(
    'DRIVER_DELIVERY_PICKUP_RADIUS_METERS',
    config.pickupRadiusMeters,
  );
  requirePositiveInteger(
    'DRIVER_DELIVERY_DROPOFF_RADIUS_METERS',
    config.dropoffRadiusMeters,
  );
}
