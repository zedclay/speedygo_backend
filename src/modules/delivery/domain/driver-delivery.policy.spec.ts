import { haversineMeters } from '../../matching/domain/matching.policy';
import {
  actionRequiresArrivalLocation,
  allowedActionsForStatus,
  decideArrivalLocation,
  DRIVER_DELIVERY_ACTION_START_TO_PICKUP,
  DRIVER_DELIVERY_DROPOFF_RADIUS_METERS,
  DRIVER_DELIVERY_PICKUP_RADIUS_METERS,
  transitionForAction,
} from './driver-delivery.policy';

describe('Driver Delivery policy', () => {
  it('requires exact previous states and does not skip', () => {
    expect(transitionForAction('start-to-pickup')).toMatchObject({
      from: 'DRIVER_ASSIGNED',
      to: 'TO_PICKUP',
    });
    expect(transitionForAction('arrive-pickup').from).toBe('TO_PICKUP');
    expect(transitionForAction('confirm-pickup').from).toBe('AT_PICKUP');
    expect(transitionForAction('start-delivery').from).toBe('PICKED_UP');
    expect(transitionForAction('arrive-customer').from).toBe('IN_TRANSIT');
    expect(transitionForAction('complete-delivery').from).toBe(
      'ARRIVED_CUSTOMER',
    );
    expect(allowedActionsForStatus('DRIVER_ASSIGNED')).toEqual([
      DRIVER_DELIVERY_ACTION_START_TO_PICKUP,
    ]);
    expect(allowedActionsForStatus('SEARCHING_DRIVER')).toEqual([]);
  });

  it('freezes DeliveryEvent vocabulary for each action', () => {
    expect(transitionForAction('start-to-pickup').eventType).toBe(
      'DRIVER_STARTED_TO_PICKUP',
    );
    expect(transitionForAction('arrive-pickup').eventType).toBe(
      'DRIVER_ARRIVED_PICKUP',
    );
    expect(transitionForAction('confirm-pickup').eventType).toBe(
      'ORDER_PICKED_UP',
    );
    expect(transitionForAction('start-delivery').eventType).toBe(
      'DELIVERY_IN_TRANSIT',
    );
    expect(transitionForAction('arrive-customer').eventType).toBe(
      'DRIVER_ARRIVED_CUSTOMER',
    );
    expect(transitionForAction('complete-delivery').eventType).toBe(
      'DELIVERY_COMPLETED',
    );
  });

  it('requires location only for arrival actions', () => {
    expect(actionRequiresArrivalLocation('arrive-pickup')).toBe(true);
    expect(actionRequiresArrivalLocation('arrive-customer')).toBe(true);
    expect(actionRequiresArrivalLocation('start-to-pickup')).toBe(false);
    expect(actionRequiresArrivalLocation('confirm-pickup')).toBe(false);
    expect(actionRequiresArrivalLocation('start-delivery')).toBe(false);
    expect(actionRequiresArrivalLocation('complete-delivery')).toBe(false);
  });

  it('treats missing and stale arrival locations as fail-closed', () => {
    const target = { targetLatitude: 36.75, targetLongitude: 3.05 };
    expect(
      decideArrivalLocation({
        location: null,
        ...target,
        maxAgeMs: 45_000,
        radiusMeters: 300,
      }),
    ).toBe('missing');
    expect(
      decideArrivalLocation({
        location: {
          latitude: 36.75,
          longitude: 3.05,
          recordedAt: '2020-01-01T00:00:00.000Z',
        },
        ...target,
        maxAgeMs: 45_000,
        radiusMeters: 300,
        nowMs: Date.parse('2026-09-02T00:00:45.001Z'),
      }),
    ).toBe('stale');
    expect(
      decideArrivalLocation({
        location: {
          latitude: 36.75,
          longitude: 3.05,
          recordedAt: '2026-09-02T00:00:00.000Z',
        },
        ...target,
        maxAgeMs: 45_000,
        radiusMeters: 300,
        nowMs: Date.parse('2026-09-02T00:00:45.000Z'),
      }),
    ).toBe('ok');
  });

  it('treats the 300m pickup/dropoff radius as inclusive', () => {
    expect(DRIVER_DELIVERY_PICKUP_RADIUS_METERS).toBe(300);
    expect(DRIVER_DELIVERY_DROPOFF_RADIUS_METERS).toBe(300);
    const originLat = 36.75;
    const originLon = 3.05;
    let north = originLat + 300 / 111_320;
    let distance = haversineMeters(originLat, originLon, north, originLon);
    while (distance > 300) {
      north -= 0.000001;
      distance = haversineMeters(originLat, originLon, north, originLon);
    }
    expect(
      decideArrivalLocation({
        location: {
          latitude: north,
          longitude: originLon,
          recordedAt: '2026-09-02T00:00:00.000Z',
        },
        targetLatitude: originLat,
        targetLongitude: originLon,
        maxAgeMs: 45_000,
        radiusMeters: 300,
        nowMs: Date.parse('2026-09-02T00:00:01.000Z'),
      }),
    ).toBe('ok');
    expect(
      decideArrivalLocation({
        location: {
          latitude: originLat + 0.01,
          longitude: originLon,
          recordedAt: '2026-09-02T00:00:00.000Z',
        },
        targetLatitude: originLat,
        targetLongitude: originLon,
        maxAgeMs: 45_000,
        radiusMeters: 300,
        nowMs: Date.parse('2026-09-02T00:00:01.000Z'),
      }),
    ).toBe('too_far');
  });
});
