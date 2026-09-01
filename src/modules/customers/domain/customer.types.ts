export type CustomerProfileRecord = {
  id: string;
  accountId: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AddressRecord = {
  id: string;
  customerId: string;
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export const CUSTOMER_ADDRESS_TEXT_MAX_LENGTH = 500;

export type CreateProfileInput = {
  fullName: string;
};

export type UpdateProfileInput = {
  fullName?: string;
};

export type CreateAddressInput = {
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
};

export type UpdateAddressInput = {
  label?: string;
  addressText?: string;
  latitude?: number;
  longitude?: number;
};

export type CustomerProfileView = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAddressView = {
  id: string;
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerMeView = {
  customerProfileExists: boolean;
  profileComplete: boolean;
  addressReady: boolean;
  profile: CustomerProfileView | null;
  addresses: CustomerAddressView[];
  defaultAddressId: string | null;
};

export function isProfileComplete(fullName: string): boolean {
  return fullName.trim().length > 0;
}

export function isAddressReady(
  addresses: Pick<AddressRecord, 'isDefault'>[],
): boolean {
  return addresses.length > 0 && addresses.some((address) => address.isDefault);
}

export function toProfileView(
  profile: CustomerProfileRecord,
): CustomerProfileView {
  return {
    id: profile.id,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toAddressView(address: AddressRecord): CustomerAddressView {
  return {
    id: address.id,
    label: address.label,
    addressText: address.addressText,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

export function hasValidCoordinates(
  latitude: number,
  longitude: number,
): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}
