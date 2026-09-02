export type DriverLocationRecord = {
  driverId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

export type GeoCandidate = {
  driverId: string;
  distanceMeters: number;
  recordedAt: string;
};

export type AssignmentRecord = {
  id: string;
  deliveryId: string;
  driverId: string;
  status: string;
  assignedAt: string;
  acceptedAt: string | null;
  releasedAt: string | null;
};

export type MatchingContext = {
  deliveryId: string;
  orderId: string;
  publicReference: string;
  deliveryStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  pickup: {
    merchantBranchId: string;
    name: string;
    addressText: string;
    latitude: number;
    longitude: number;
  };
  dropoff: {
    addressText: string;
    latitude: number;
    longitude: number;
  };
  driverRemunerationMinor: number;
};

export type AssignmentOfferView = {
  assignmentId: string;
  deliveryId: string;
  orderPublicReference: string;
  status: string;
  offeredAt: string;
  expiresAt: string;
  driverRemunerationMinor: number;
  pickup: {
    name: string;
  };
  pickupDistanceMeters: number;
  deliveryDistanceMeters: number | null;
};

export type AcceptedAssignmentView = {
  assignmentId: string;
  deliveryId: string;
  orderPublicReference: string;
  status: string;
  acceptedAt: string | null;
  driverRemunerationMinor: number;
  pickup: {
    name: string;
    addressText: string;
    latitude: number;
    longitude: number;
  };
  dropoff: {
    addressText: string;
    latitude: number;
    longitude: number;
  };
};

export type MatchingStartResult = {
  deliveryId: string;
  deliveryStatus: string;
  assignment: AssignmentRecord | null;
  offered: boolean;
};

export interface DriverLocationStore {
  upsert(
    driverId: string,
    latitude: number,
    longitude: number,
    recordedAt?: string,
  ): Promise<DriverLocationRecord>;
  get(driverId: string): Promise<DriverLocationRecord | null>;
  searchNear(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
  ): Promise<GeoCandidate[]>;
}

export const DRIVER_LOCATION_STORE = Symbol('DRIVER_LOCATION_STORE');
