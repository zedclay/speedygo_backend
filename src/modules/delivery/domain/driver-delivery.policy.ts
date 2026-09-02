import {
  haversineMeters,
  isLocationFresh,
  isValidLocation,
  isWithinPickupRadius,
} from '../../matching/domain/matching.policy';
import {
  DELIVERY_STATUS_ARRIVED_CUSTOMER,
  DELIVERY_STATUS_AT_PICKUP,
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_IN_TRANSIT,
  DELIVERY_STATUS_PICKED_UP,
  DELIVERY_STATUS_TO_PICKUP,
} from './delivery.policy';

export const DRIVER_DELIVERY_PICKUP_RADIUS_METERS = 300;
export const DRIVER_DELIVERY_DROPOFF_RADIUS_METERS = 300;

export const ASSIGNMENT_STATUS_RELEASED = 'RELEASED';

export const DRIVER_DELIVERY_ACTION_START_TO_PICKUP = 'start-to-pickup';
export const DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP = 'arrive-pickup';
export const DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP = 'confirm-pickup';
export const DRIVER_DELIVERY_ACTION_START_DELIVERY = 'start-delivery';
export const DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER = 'arrive-customer';
export const DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY = 'complete-delivery';

export const DRIVER_DELIVERY_ACTIONS = [
  DRIVER_DELIVERY_ACTION_START_TO_PICKUP,
  DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP,
  DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP,
  DRIVER_DELIVERY_ACTION_START_DELIVERY,
  DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER,
  DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY,
] as const;

export type DriverDeliveryAction = (typeof DRIVER_DELIVERY_ACTIONS)[number];

export const DELIVERY_EVENT_STARTED_TO_PICKUP = 'DRIVER_STARTED_TO_PICKUP';
export const DELIVERY_EVENT_ARRIVED_PICKUP = 'DRIVER_ARRIVED_PICKUP';
export const DELIVERY_EVENT_ORDER_PICKED_UP = 'ORDER_PICKED_UP';
export const DELIVERY_EVENT_IN_TRANSIT = 'DELIVERY_IN_TRANSIT';
export const DELIVERY_EVENT_ARRIVED_CUSTOMER = 'DRIVER_ARRIVED_CUSTOMER';
export const DELIVERY_EVENT_COMPLETED = 'DELIVERY_COMPLETED';

export type DriverDeliveryTransition = {
  from: string;
  to: string;
  eventType: string;
  timestampField: 'pickedUpAt' | 'arrivedCustomerAt' | 'deliveredAt' | null;
};

const TRANSITIONS: Record<DriverDeliveryAction, DriverDeliveryTransition> = {
  [DRIVER_DELIVERY_ACTION_START_TO_PICKUP]: {
    from: DELIVERY_STATUS_DRIVER_ASSIGNED,
    to: DELIVERY_STATUS_TO_PICKUP,
    eventType: DELIVERY_EVENT_STARTED_TO_PICKUP,
    timestampField: null,
  },
  [DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP]: {
    from: DELIVERY_STATUS_TO_PICKUP,
    to: DELIVERY_STATUS_AT_PICKUP,
    eventType: DELIVERY_EVENT_ARRIVED_PICKUP,
    timestampField: null,
  },
  [DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP]: {
    from: DELIVERY_STATUS_AT_PICKUP,
    to: DELIVERY_STATUS_PICKED_UP,
    eventType: DELIVERY_EVENT_ORDER_PICKED_UP,
    timestampField: 'pickedUpAt',
  },
  [DRIVER_DELIVERY_ACTION_START_DELIVERY]: {
    from: DELIVERY_STATUS_PICKED_UP,
    to: DELIVERY_STATUS_IN_TRANSIT,
    eventType: DELIVERY_EVENT_IN_TRANSIT,
    timestampField: null,
  },
  [DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER]: {
    from: DELIVERY_STATUS_IN_TRANSIT,
    to: DELIVERY_STATUS_ARRIVED_CUSTOMER,
    eventType: DELIVERY_EVENT_ARRIVED_CUSTOMER,
    timestampField: 'arrivedCustomerAt',
  },
  [DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY]: {
    from: DELIVERY_STATUS_ARRIVED_CUSTOMER,
    to: DELIVERY_STATUS_DELIVERED,
    eventType: DELIVERY_EVENT_COMPLETED,
    timestampField: 'deliveredAt',
  },
};

export function transitionForAction(
  action: DriverDeliveryAction,
): DriverDeliveryTransition {
  return TRANSITIONS[action];
}

export function allowedActionsForStatus(
  status: string,
): DriverDeliveryAction[] {
  return DRIVER_DELIVERY_ACTIONS.filter(
    (action) => TRANSITIONS[action].from === status,
  );
}

export function isDriverDeliveryAction(
  value: string,
): value is DriverDeliveryAction {
  return (DRIVER_DELIVERY_ACTIONS as readonly string[]).includes(value);
}

export function actionRequiresArrivalLocation(
  action: DriverDeliveryAction,
): boolean {
  return (
    action === DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP ||
    action === DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER
  );
}

export type ArrivalLocationDecision = 'ok' | 'missing' | 'stale' | 'too_far';

export function decideArrivalLocation(input: {
  location: {
    latitude: number;
    longitude: number;
    recordedAt: string;
  } | null;
  targetLatitude: number;
  targetLongitude: number;
  maxAgeMs: number;
  radiusMeters: number;
  nowMs?: number;
}): ArrivalLocationDecision {
  if (!input.location) {
    return 'missing';
  }
  if (
    !isValidLocation(input.location.latitude, input.location.longitude) ||
    !isValidLocation(input.targetLatitude, input.targetLongitude)
  ) {
    return 'too_far';
  }
  if (
    !isLocationFresh(input.location.recordedAt, input.maxAgeMs, input.nowMs)
  ) {
    return 'stale';
  }
  const distance = haversineMeters(
    input.location.latitude,
    input.location.longitude,
    input.targetLatitude,
    input.targetLongitude,
  );
  if (!isWithinPickupRadius(distance, input.radiusMeters)) {
    return 'too_far';
  }
  return 'ok';
}
