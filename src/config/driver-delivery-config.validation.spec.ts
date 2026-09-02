import { assertDriverDeliveryConfig } from './driver-delivery-config.validation';

const valid = {
  pickupRadiusMeters: 300,
  dropoffRadiusMeters: 300,
};

describe('assertDriverDeliveryConfig', () => {
  it('accepts the frozen 300m radii', () => {
    expect(() => assertDriverDeliveryConfig(valid)).not.toThrow();
  });

  it('rejects non-positive radii', () => {
    expect(() =>
      assertDriverDeliveryConfig({ ...valid, pickupRadiusMeters: 0 }),
    ).toThrow('DRIVER_DELIVERY_PICKUP_RADIUS_METERS');
    expect(() =>
      assertDriverDeliveryConfig({ ...valid, dropoffRadiusMeters: -1 }),
    ).toThrow('DRIVER_DELIVERY_DROPOFF_RADIUS_METERS');
  });
});
