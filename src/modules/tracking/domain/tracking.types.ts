export const TRACKING_STATUS_LIVE = 'LIVE';
export const TRACKING_STATUS_STALE = 'STALE';
export const TRACKING_STATUS_UNAVAILABLE = 'UNAVAILABLE';
export const TRACKING_STATUS_NO_DRIVER = 'NO_DRIVER';

export const TRACKING_STATUSES = [
  TRACKING_STATUS_LIVE,
  TRACKING_STATUS_STALE,
  TRACKING_STATUS_UNAVAILABLE,
  TRACKING_STATUS_NO_DRIVER,
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export type TrackingLocationView = {
  deliveryId: string;
  assignedDriverId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyMeters: number | null;
};

export type TrackingSnapshot = {
  deliveryId: string | null;
  orderId: string;
  driverAssigned: boolean;
  assignedDriverId: string | null;
  status: TrackingStatus;
  isStale: boolean;
  location: TrackingLocationView | null;
};

export type TrackingActor = 'customer' | 'merchant' | 'driver';

export type TrackingSubscribeResult = {
  snapshot: TrackingSnapshot;
  room: string;
  actor: TrackingActor;
  merchantId?: string;
};

export type DriverLocationPublishResult = {
  driverId: string;
  recordedAt: string;
  applied: boolean;
  broadcast: boolean;
  deliveryId: string | null;
  rooms: string[];
};

export type LocationUpdateInput = {
  latitude: unknown;
  longitude: unknown;
  accuracyMeters?: unknown;
};
