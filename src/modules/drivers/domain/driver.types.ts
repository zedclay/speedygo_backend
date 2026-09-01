export type DriverProfileRecord = {
  id: string;
  accountId: string;
  fullName: string;
  verificationStatus: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriverAvailabilityRecord = {
  driverId: string;
  status: string;
  currentZoneId: string | null;
  offlineAfterCurrentDelivery: boolean;
  updatedAt: string;
};

export type DriverDocumentRecord = {
  id: string;
  driverId: string;
  type: string;
  fileUrl: string;
  status: string;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriverVehicleRecord = {
  id: string;
  driverId: string;
  type: string;
  plateNumber: string;
  model: string;
  color: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DriverDocumentView = {
  type: string;
  expiryDate: string | null;
  present: boolean;
};

export type DriverVehicleView = {
  id: string;
  type: string;
  plateNumber: string;
  model: string;
  color: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DriverAvailabilityView = {
  status: string;
  offlineAfterCurrentDelivery: boolean;
  updatedAt: string;
};

export type DriverProfileView = {
  id: string;
  fullName: string;
  verificationStatus: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriverReadinessView = {
  profileComplete: boolean;
  identityDocumentComplete: boolean;
  drivingLicenseComplete: boolean;
  vehicleComplete: boolean;
  verificationSubmitted: boolean;
  verificationApproved: boolean;
  operationalReady: boolean;
  matchingEligible: boolean;
};

export type DriverMeView = DriverReadinessView & {
  driverProfileExists: boolean;
  profile: DriverProfileView | null;
  documents: DriverDocumentView[];
  vehicles: DriverVehicleView[];
  availability: DriverAvailabilityView | null;
};

export type CreateDriverProfileInput = {
  fullName: string;
};

export type UpdateDriverProfileInput = {
  fullName?: string;
};

export type UpsertDocumentInput = {
  type: string;
  expiryDate: string | null;
};

export type CreateVehicleInput = {
  type: string;
  plateNumber: string;
  model: string;
  color: string | null;
};

export type UpdateVehicleInput = {
  type?: string;
  plateNumber?: string;
  model?: string;
  color?: string | null;
};

export function toProfileView(profile: DriverProfileRecord): DriverProfileView {
  return {
    id: profile.id,
    fullName: profile.fullName,
    verificationStatus: profile.verificationStatus,
    approvedAt: profile.approvedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toDocumentView(
  document: DriverDocumentRecord,
): DriverDocumentView {
  return {
    type: document.type,
    expiryDate: document.expiryDate,
    present: true,
  };
}

export function toVehicleView(vehicle: DriverVehicleRecord): DriverVehicleView {
  return {
    id: vehicle.id,
    type: vehicle.type,
    plateNumber: vehicle.plateNumber,
    model: vehicle.model,
    color: vehicle.color,
    status: vehicle.status,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}

export function toAvailabilityView(
  availability: DriverAvailabilityRecord,
): DriverAvailabilityView {
  return {
    status: availability.status,
    offlineAfterCurrentDelivery: availability.offlineAfterCurrentDelivery,
    updatedAt: availability.updatedAt,
  };
}
