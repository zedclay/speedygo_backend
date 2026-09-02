export const TRACKING_NAMESPACE = '/realtime';

export const TRACKING_EVENT_LOCATION_UPDATE = 'driver:location:update';
export const TRACKING_EVENT_SUBSCRIBE = 'tracking:subscribe';
export const TRACKING_EVENT_UNSUBSCRIBE = 'tracking:unsubscribe';
export const TRACKING_EVENT_LOCATION = 'tracking:location';
export const TRACKING_EVENT_STATUS = 'tracking:status';
export const TRACKING_EVENT_ERROR = 'tracking:error';

export function customerTrackingRoom(
  deliveryId: string,
  customerProfileId: string,
): string {
  return `tracking:delivery:${deliveryId}:customer:${customerProfileId}`;
}

export function merchantTrackingRoom(
  deliveryId: string,
  merchantId: string,
): string {
  return `tracking:delivery:${deliveryId}:merchant:${merchantId}`;
}

export function driverTrackingRoom(
  deliveryId: string,
  driverId: string,
): string {
  return `tracking:delivery:${deliveryId}:driver:${driverId}`;
}
